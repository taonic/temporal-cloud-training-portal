import { ApplicationFailure, log } from '@temporalio/activity';
import { config } from '@/config';
import {
  CloudOpsError,
  createUser,
  deleteInventoryItem,
  deleteUser,
  findUserByEmail,
  getCurrentIdentity,
  snapshotInventory,
} from '@/cloud/ops';
import type { InventoryItem } from '@/cloud/types';
import type { AccessWindow, SweepDecision, SweepReport } from './shared';

/**
 * Every Cloud Ops call the portal makes lives in an activity, so retries,
 * timeouts and the audit trail all come from Temporal rather than ad-hoc
 * try/catch. Deletions in particular must be idempotent — activities can and
 * will run more than once.
 */

/** Auth failures are permanent: retrying a revoked API key just burns attempts. */
function rethrowAsNonRetryableIfAuth(err: unknown, context: string): never {
  if (err instanceof CloudOpsError && err.isAuthFailure) {
    throw ApplicationFailure.nonRetryable(
      `${context}: Cloud Ops credential rejected (${err.message}). ` +
        `The portal's API key on the training account is invalid, expired, or was deleted.`,
      'CloudOpsAuthFailure',
    );
  }
  throw err;
}

/* -------------------------------------------------------------------------- */
/* Invitation                                                                  */
/* -------------------------------------------------------------------------- */

export async function inviteGlobalAdmin(args: {
  email: string;
  asyncOperationId: string;
}): Promise<{ userId: string; preexisting: boolean }> {
  try {
    // A user may already exist — re-running the portal, or you invited them by
    // hand. Adopt rather than duplicate; CreateUser would fail anyway.
    const existing = await findUserByEmail(args.email);
    if (existing) {
      log.info('Adopting existing Cloud user', { email: args.email, userId: existing.id });
      return { userId: existing.id, preexisting: true };
    }

    const { userId } = await createUser({
      email: args.email,
      role: 'ROLE_ADMIN',
      asyncOperationId: args.asyncOperationId,
    });

    if (!userId) {
      throw ApplicationFailure.retryable('CreateUser returned no user id', 'CloudOpsUnexpected');
    }

    log.info('Invited Global Admin', { email: args.email, userId });
    return { userId, preexisting: false };
  } catch (err) {
    rethrowAsNonRetryableIfAuth(err, 'inviteGlobalAdmin');
  }
}

export async function revokeUser(args: {
  userId: string;
  email: string;
  asyncOperationId: string;
}): Promise<void> {
  try {
    // Re-read to get a current resourceVersion; the student may have changed
    // their own record (they are, after all, a Global Admin).
    const current = await findUserByEmail(args.email);
    const resourceVersion = current?.resource_version;

    await deleteUser({
      userId: args.userId,
      resourceVersion,
      asyncOperationId: args.asyncOperationId,
    });
    log.info('Revoked access', { email: args.email, userId: args.userId });
  } catch (err) {
    rethrowAsNonRetryableIfAuth(err, 'revokeUser');
  }
}

/* -------------------------------------------------------------------------- */
/* Baseline + sweeper                                                          */
/* -------------------------------------------------------------------------- */

export async function captureBaseline(): Promise<InventoryItem[]> {
  try {
    const inventory = await snapshotInventory();
    log.info('Captured baseline inventory', { size: inventory.length });
    return inventory;
  } catch (err) {
    rethrowAsNonRetryableIfAuth(err, 'captureBaseline');
  }
}

const key = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;

/**
 * Baseline-diff with a time window.
 *
 * A resource is deleted only when all three hold:
 *   1. it is absent from the baseline snapshot, and
 *   2. its creation time falls inside at least one student access window, and
 *   3. every window containing it has already closed.
 *
 * Condition (2) is what stops a stale baseline from eating resources created
 * long after the workshop: anything born outside every window is reported as
 * drift and left alone, however old the baseline gets.
 */
export async function sweepOnce(args: {
  baseline: InventoryItem[];
  windows: AccessWindow[];
  nowMs: number;
}): Promise<SweepReport> {
  const cfg = config();
  const mode = cfg.SWEEPER_MODE;

  let inventory: InventoryItem[];
  try {
    inventory = await snapshotInventory();
  } catch (err) {
    rethrowAsNonRetryableIfAuth(err, 'sweepOnce');
  }

  const baselineKeys = new Set(args.baseline.map(key));
  const decisions: SweepDecision[] = [];

  for (const item of inventory) {
    if (baselineKeys.has(key(item))) continue;

    const base: SweepDecision = {
      kind: item.kind,
      id: item.id,
      label: item.label,
      createdAtMs: item.createdAtMs,
      disposition: 'unknown-age',
    };

    if (item.createdAtMs === undefined) {
      // No creation timestamp means we cannot place it in a window, and we do
      // not delete what we cannot date.
      decisions.push(base);
      continue;
    }

    const containing = args.windows.filter(
      (w) => item.createdAtMs! >= w.startMs && item.createdAtMs! <= w.endMs,
    );

    if (containing.length === 0) {
      decisions.push({ ...base, disposition: 'outside-any-window' });
      continue;
    }

    const allClosed = containing.every((w) => w.endMs <= args.nowMs);
    if (!allClosed) {
      decisions.push({ ...base, disposition: 'in-open-window' });
      continue;
    }

    if (mode === 'dry-run') {
      decisions.push({ ...base, disposition: 'would-delete' });
      continue;
    }

    try {
      await deleteInventoryItem(item, `sweep-${item.kind}-${item.id}-${args.nowMs}`);
      decisions.push({ ...base, disposition: 'deleted' });
      log.info('Swept resource', { kind: item.kind, id: item.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      decisions.push({ ...base, disposition: 'delete-failed', error: message });
      log.warn('Sweep delete failed', { kind: item.kind, id: item.id, error: message });
    }
  }

  return { atMs: args.nowMs, mode, inventorySize: inventory.length, decisions };
}

/* -------------------------------------------------------------------------- */
/* Canary                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cheapest possible authenticated read. A Global Admin student can delete the
 * identity behind the portal's API key; there is no way to prevent that, so we
 * detect it instead.
 */
export async function pingCloudOps(): Promise<{ identity: string }> {
  const { user, serviceAccount, apiKey } = await getCurrentIdentity();
  const identity =
    user?.spec?.email ?? serviceAccount?.spec?.name ?? apiKey?.spec?.display_name ?? 'unknown';
  return { identity };
}

/* -------------------------------------------------------------------------- */
/* Workflow starting (called from the registry's update handler)                */
/* -------------------------------------------------------------------------- */

/**
 * Starting is deliberately idempotent rather than "signal with start": a second
 * submission of the same address must be a no-op, not a second user and not a
 * silently extended window. The workflow id is derived from the email, so the
 * server enforces this for us.
 */
export async function startInvitationWorkflow(args: {
  workflowId: string;
  email: string;
  grantedAtMs: number;
  ttlMs: number;
}): Promise<{ started: boolean }> {
  // Imported lazily: @temporalio/client must not be pulled into the workflow bundle.
  const { getTemporalClient } = await import('./client');
  const { WorkflowExecutionAlreadyStartedError } = await import('@temporalio/client');
  const client = await getTemporalClient();

  try {
    await client.workflow.start('invitation', {
      workflowId: args.workflowId,
      taskQueue: config().TEMPORAL_TASK_QUEUE,
      args: [{ email: args.email, grantedAtMs: args.grantedAtMs, ttlMs: args.ttlMs }],
    });
    return { started: true };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      log.info('Invitation already running; treating as no-op', { email: args.email });
      return { started: false };
    }
    throw err;
  }
}
