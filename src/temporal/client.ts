import { Client, Connection } from '@temporalio/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from '@/config';
import {
  CANARY_WORKFLOW_ID,
  NAMES,
  REGISTRY_WORKFLOW_ID,
  invitationWorkflowId,
  type CanaryState,
  type ExtendWindowsRequest,
  type ExtendWindowsResult,
  type InvitationState,
  type RegistryState,
  type SeatDecision,
  type SeatRequest,
} from './shared';

/**
 * Connection to the account that RUNS the portal (a2dd6) — deliberately not the
 * account students are given Global Admin on. A student cannot reach this
 * namespace, so they cannot delete the workflows that will later delete them.
 */

/**
 * Shared by the Client (`@temporalio/client`) and the Worker's NativeConnection.
 * Both accept this shape; typing it once keeps the two from drifting apart.
 */
export interface SharedConnectionOptions {
  address: string;
  tls: true | { clientCertPair: { crt: Buffer; key: Buffer } };
  apiKey?: string;
  metadata?: Record<string, string>;
}

export function connectionOptions(): SharedConnectionOptions {
  const cfg = config();

  if (cfg.TEMPORAL_API_KEY) {
    return {
      address: cfg.TEMPORAL_ADDRESS,
      tls: true,
      apiKey: cfg.TEMPORAL_API_KEY,
      // Required in addition to the Client's `namespace` when using API keys.
      metadata: { 'temporal-namespace': cfg.TEMPORAL_NAMESPACE },
    };
  }

  // Base64-encoded PEM takes precedence: on Fly.io and similar, secrets arrive
  // as environment variables and there is no file to point at.
  if (cfg.TEMPORAL_TLS_CLIENT_CERT_DATA && cfg.TEMPORAL_TLS_CLIENT_KEY_DATA) {
    return {
      address: cfg.TEMPORAL_ADDRESS,
      tls: {
        clientCertPair: {
          crt: Buffer.from(cfg.TEMPORAL_TLS_CLIENT_CERT_DATA, 'base64'),
          key: Buffer.from(cfg.TEMPORAL_TLS_CLIENT_KEY_DATA, 'base64'),
        },
      },
    };
  }

  if (cfg.TEMPORAL_TLS_CLIENT_CERT_PATH && cfg.TEMPORAL_TLS_CLIENT_KEY_PATH) {
    return {
      address: cfg.TEMPORAL_ADDRESS,
      tls: {
        clientCertPair: {
          crt: readFileSync(cfg.TEMPORAL_TLS_CLIENT_CERT_PATH),
          key: readFileSync(cfg.TEMPORAL_TLS_CLIENT_KEY_PATH),
        },
      },
    };
  }

  throw new Error(
    'No Temporal credentials. Set TEMPORAL_API_KEY (with a regional address), or ' +
      'TEMPORAL_TLS_CLIENT_CERT_DATA + TEMPORAL_TLS_CLIENT_KEY_DATA (base64 PEM), or ' +
      'TEMPORAL_TLS_CLIENT_CERT_PATH + TEMPORAL_TLS_CLIENT_KEY_PATH — the last two with the namespace address.',
  );
}

let clientPromise: Promise<Client> | undefined;

export async function getTemporalClient(): Promise<Client> {
  clientPromise ??= (async () => {
    const cfg = config();
    const connection = await Connection.connect(connectionOptions());
    return new Client({ connection, namespace: cfg.TEMPORAL_NAMESPACE });
  })();
  return clientPromise;
}

/** Workflow ids must not leak email addresses into the Cloud UI's workflow list. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export const workflowIdForEmail = (email: string) => invitationWorkflowId(emailHash(email));

/* -------------------------------------------------------------------------- */
/* Singleton lifecycle                                                         */
/* -------------------------------------------------------------------------- */

async function startIfAbsent(
  workflowType: string,
  workflowId: string,
  args: unknown[],
): Promise<void> {
  const cfg = config();
  const client = await getTemporalClient();
  const { WorkflowExecutionAlreadyStartedError } = await import('@temporalio/client');

  try {
    await client.workflow.start(workflowType, {
      workflowId,
      taskQueue: cfg.TEMPORAL_TASK_QUEUE,
      args,
    });
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return;
    throw err;
  }
}

export async function ensureSingletonsRunning(): Promise<void> {
  const cfg = config();
  await Promise.all([
    startIfAbsent('trainingRegistry', REGISTRY_WORKFLOW_ID, [
      { sweepIntervalMs: cfg.SWEEPER_INTERVAL_MINUTES * 60 * 1000 },
    ]),
    startIfAbsent('opsCanary', CANARY_WORKFLOW_ID, [5 * 60 * 1000]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Reads and writes used by the web layer                                      */
/* -------------------------------------------------------------------------- */

export async function requestSeat(req: SeatRequest): Promise<SeatDecision> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(REGISTRY_WORKFLOW_ID);
  return handle.executeUpdate<SeatDecision, [SeatRequest]>(NAMES.requestSeat, { args: [req] });
}

export async function getRegistryState(): Promise<RegistryState | undefined> {
  try {
    const client = await getTemporalClient();
    return await client.workflow
      .getHandle(REGISTRY_WORKFLOW_ID)
      .query<RegistryState>(NAMES.registryState);
  } catch {
    return undefined;
  }
}

export async function getCanaryState(): Promise<CanaryState | undefined> {
  try {
    const client = await getTemporalClient();
    return await client.workflow.getHandle(CANARY_WORKFLOW_ID).query<CanaryState>(NAMES.canaryState);
  } catch {
    return undefined;
  }
}

export async function getInvitationState(email: string): Promise<InvitationState | undefined> {
  try {
    const client = await getTemporalClient();
    return await client.workflow
      .getHandle(workflowIdForEmail(email))
      .query<InvitationState>(NAMES.invitationState);
  } catch {
    return undefined;
  }
}

export async function revokeAccess(email: string, reason?: string): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.getHandle(workflowIdForEmail(email)).signal(NAMES.revoke, reason);
}

export async function extendAccess(email: string, extraMs: number): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.getHandle(workflowIdForEmail(email)).signal(NAMES.extend, extraMs);
}

/**
 * The other half of extending a student — see ExtendWindowsRequest for why one
 * without the other loses their work. `pnpm ops:extend` calls this first.
 */
export async function extendWindows(req: ExtendWindowsRequest): Promise<ExtendWindowsResult> {
  const client = await getTemporalClient();
  return client.workflow
    .getHandle(REGISTRY_WORKFLOW_ID)
    .executeUpdate<ExtendWindowsResult, [ExtendWindowsRequest]>(NAMES.extendWindows, { args: [req] });
}

export async function triggerSweep(): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.getHandle(REGISTRY_WORKFLOW_ID).signal(NAMES.sweepNow);
}
