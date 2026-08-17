import { accessTtlMs, config } from '@/config';
import {
  findUserByEmail,
  listAuditLogs,
  listApiKeys,
  listConnectivityRules,
  listCustomRoles,
  listNamespaces,
  listServiceAccounts,
  listUserGroups,
} from '@/cloud/ops';
import type {
  CloudApiKey,
  CloudAuditLogRecord,
  CloudConnectivityRule,
  CloudCustomRole,
  CloudNamespace,
  CloudServiceAccount,
  CloudUser,
  CloudUserGroup,
} from '@/cloud/types';
import { namespaceReader } from '@/cloud/dataplane';
import { getSession } from './index';
import {
  labCustomRoleName,
  labGroupName,
  labMetricsAccountName,
  labNamespaceName,
  labServiceAccountName,
} from './naming';
import type {
  CheckpointResult,
  CheckpointStatus,
  GradeContext,
  GradeResult,
  SessionDef,
} from './types';

/** Memoises a zero-arg async call so several checkpoints can share one fetch. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= fn());
}

function buildContext(session: SessionDef, email: string): GradeContext {
  const cfg = config();
  const namespaceName = labNamespaceName(email, cfg.LAB_NAMESPACE_PREFIX);

  const namespaces = once<CloudNamespace[]>(listNamespaces);
  const apiKeys = once<CloudApiKey[]>(listApiKeys);
  const serviceAccounts = once<CloudServiceAccount[]>(listServiceAccounts);
  const userGroups = once<CloudUserGroup[]>(() => listUserGroups().catch(() => []));
  // Custom roles are Pre-release; an account without them should show the
  // checkpoint as failed, not blow up the whole grade.
  const customRoles = once<CloudCustomRole[]>(() => listCustomRoles().catch(() => []));
  const connectivityRules = once<CloudConnectivityRule[]>(() =>
    listConnectivityRules().catch(() => []),
  );

  // Scoped to the access window rather than the log's full 30 days: everything
  // a student did happened inside it, and the account-wide log of a whole
  // cohort is a lot of pages to walk for one checkpoint. Audit Logs need
  // Account Owner or Global Admin — the portal has that, but an account that
  // cannot serve them should fail one checkpoint, not the whole grade.
  const auditLogs = once<{ records: CloudAuditLogRecord[]; truncated: boolean }>(() =>
    listAuditLogs({ sinceMs: Date.now() - accessTtlMs() }).catch(() => ({
      records: [],
      truncated: false,
    })),
  );
  const cloudUser = once<CloudUser | undefined>(() => findUserByEmail(email));

  const labNamespace = once<CloudNamespace | undefined>(async () => {
    // Cloud namespace ids are `<name>.<account>`; match on either form.
    const all = await namespaces();
    return all.find((n) => n.namespace === namespaceName || n.spec?.name === namespaceName);
  });

  const dataPlane = once(() => namespaceReader(`${namespaceName}.${cfg.TRAINING_ACCOUNT_ID}`));

  const mk = (id: string, status: CheckpointStatus, observed?: string): CheckpointResult => {
    const def = session.checkpoints.find((c) => c.id === id);
    if (!def) {
      throw new Error(`Session ${session.number} graded unknown checkpoint "${id}"`);
    }
    return {
      ...def,
      selfAttested: def.selfAttested ?? false,
      optional: def.optional ?? false,
      status,
      observed,
    };
  };

  return {
    email,
    namespaceName,
    serviceAccountName: labServiceAccountName(email, cfg.LAB_NAMESPACE_PREFIX),
    metricsAccountName: labMetricsAccountName(email, cfg.LAB_NAMESPACE_PREFIX),
    groupName: labGroupName(email, cfg.LAB_NAMESPACE_PREFIX),
    customRoleName: labCustomRoleName(email, cfg.LAB_NAMESPACE_PREFIX),
    requiredRegion: cfg.LAB_REQUIRED_REGION,

    namespaces,
    labNamespace,
    cloudUser,
    apiKeys,
    serviceAccounts,
    userGroups,
    customRoles,
    connectivityRules,
    auditLogs,
    dataPlane,

    mk,
    check: (id, ok, onPass, onFail) => mk(id, ok ? 'pass' : 'fail', ok ? onPass : onFail),
    blockedAll: (reason) => session.checkpoints.map((c) => mk(c.id, 'blocked', reason)),
  };
}

/**
 * Grades one session's exit criteria against the real account.
 *
 * Objective and self-attested checkpoints are counted separately: "4/4
 * objective" is a fact about the account, while the self-attested ones are
 * only a record of what the student claimed.
 */
export async function gradeSession(sessionNumber: number, email: string): Promise<GradeResult> {
  const session = getSession(sessionNumber);
  if (!session) throw new Error(`Unknown session ${sessionNumber}`);

  const ctx = buildContext(session, email);
  const results = await session.grade(ctx);

  // A session that forgets to report a checkpoint would silently look complete.
  const reported = new Set(results.map((r) => r.id));
  const missing = session.checkpoints.filter((c) => !reported.has(c.id));
  for (const def of missing) {
    results.push({
      ...def,
      selfAttested: def.selfAttested ?? false,
      optional: def.optional ?? false,
      status: 'blocked',
      observed: 'Not evaluated.',
    });
  }

  // Stretch goals don't count against the session — a student who skipped one
  // should not read as having failed.
  const objective = results.filter((r) => !r.selfAttested && !r.optional);

  return {
    session: session.number,
    email,
    expectedNamespace: ctx.namespaceName,
    requiredRegion: ctx.requiredRegion,
    checkedAtMs: Date.now(),
    results,
    passed: results.filter((r) => r.status === 'pass').length,
    objectivePassed: objective.filter((r) => r.status === 'pass').length,
    objectiveTotal: objective.length,
    total: results.length,
  };
}
