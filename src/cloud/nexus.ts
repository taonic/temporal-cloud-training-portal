import { config } from '@/config';
import { listNamespaces } from './ops';
import { namespaceReader, signalHumanDecision } from './dataplane';

/**
 * The read behind the instructor's Nexus Switchboard.
 *
 * WHY THIS READS THE CALLERS AND NOT THE DESK. The obvious design is to watch
 * the handler namespace and let each arriving `quote-<caller>` workflow put a
 * spoke on the ring. That works for exactly the rounds that do not matter: when
 * the handler is down, the Nexus Machinery retries on the CALLER's side and no
 * handler workflow is created at all, so the desk namespace shows nothing during
 * the one round worth projecting.
 *
 * So the caller namespaces are the source of truth. The lab prefix is used only
 * as a search space — a list of namespaces that *might* have called — and a
 * namespace earns a place on the ring by having a PaymentWorkflow, never by
 * being on a roster. Nothing appears until somebody calls, which is both the
 * visual we want and the honest definition at a trust boundary.
 *
 * Cost is one workflow list per candidate namespace per poll, plus one describe
 * for each caller still in flight and one history fetch for each failure. The
 * per-namespace clients in `dataplane` are cached across polls, so this settles
 * into a handful of cheap reads. A namespace that cannot be reached is dropped
 * rather than failing the payload — a student who has not built a namespace yet
 * must not be able to blank the projector.
 */

/** Matches the `PaymentWorkflow` in labs/worker. */
const CALLER_WORKFLOW_TYPE = 'PaymentWorkflow';
/** The desk's own workflow — one per call, id `review-<caller namespace>`. */
const HANDLER_WORKFLOW_TYPE = 'ReviewWorkflow';
/** How many namespaces to probe concurrently. Keeps a big cohort from stampeding. */
const CONCURRENCY = 6;
/** Most parked reviews worth showing at once. A cohort produces one each at most. */
const ESCALATION_LIMIT = 25;
/**
 * Queries run wider than the namespace probes above: they are one cheap call each,
 * and a stopped desk makes every one of them sit until its deadline. One batch of
 * this width is the difference between a screen that pauses for a beat during the
 * outage round and one that pauses for ten seconds.
 */
const QUERY_CONCURRENCY = 12;

export type CallerState = 'inflight' | 'backoff' | 'done' | 'denied' | 'failed';

export interface SwitchboardCaller {
  /** The caller's own namespace id — this is the label on the ring. */
  namespace: string;
  workflowId: string;
  state: CallerState;
  /** Nexus operation attempt count. Climbs while the desk is down. */
  attempt: number;
  /** Server-side operation state, e.g. `BackingOff`. */
  operationState?: string;
  startedAtMs?: number;
  closedAtMs?: number;
  /** Caller-observed duration, including any time the desk was unavailable. */
  latencyMs?: number;
  /** Failure text, when there is one. What makes a revoked caller legible. */
  detail?: string;
}

/**
 * A review the desk's adjudicator handed back to a person.
 *
 * Read from the DESK namespace, unlike everything else here — an escalation is
 * the one part of the segment that exists only on the handler's side, because the
 * caller cannot see it and should not be able to.
 */
export interface DeskEscalation {
  /** `review-<caller namespace>`. The id the CLI's `decide` takes. */
  workflowId: string;
  /** The caller namespace, recovered from the workflow id. */
  caller: string;
  /** What the adjudicator wants a human to settle, from the `pending` Query. */
  question: string;
  startedAtMs?: number;
}

export interface SwitchboardState {
  atMs: number;
  deskNamespace: string;
  /** Callers that have actually called, newest arrival last. */
  callers: SwitchboardCaller[];
  /** Namespaces probed but silent. Count only — they are not on the ring. */
  silent: number;
  /** Reviews parked on a human, oldest first — the queue with the buttons on it. */
  escalations: DeskEscalation[];
  /** Non-fatal problems worth showing in small type rather than throwing. */
  warnings: string[];
}

/** A permission failure reads differently from a handler crash, and the room should see which. */
function looksDenied(detail: string | undefined): boolean {
  if (!detail) return false;
  return /permission|unauthorized|not allowed|forbidden|denied/i.test(detail);
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function readCaller(namespace: string): Promise<SwitchboardCaller | undefined> {
  const reader = await namespaceReader(namespace);
  if (!reader) return undefined;

  let recent;
  try {
    recent = await reader.listWorkflows(`WorkflowType = "${CALLER_WORKFLOW_TYPE}"`, 1);
  } catch {
    return undefined;
  }
  // No PaymentWorkflow means this namespace has never called. It stays off the ring.
  const wf = recent[0];
  if (!wf) return undefined;

  const base = {
    namespace,
    workflowId: wf.workflowId,
    attempt: 0,
    startedAtMs: wf.startedAtMs,
    closedAtMs: wf.closedAtMs,
    latencyMs:
      wf.startedAtMs && wf.closedAtMs ? wf.closedAtMs - wf.startedAtMs : undefined,
  };

  if (wf.status === 'RUNNING') {
    const pending = await reader.pendingNexusOperations(wf.workflowId);
    const op = pending[0];
    const denied = looksDenied(op?.lastFailure);
    return {
      ...base,
      state: denied ? 'denied' : op && op.attempt > 1 ? 'backoff' : 'inflight',
      attempt: op?.attempt ?? 0,
      operationState: op?.state,
      detail: op?.lastFailure,
    };
  }

  if (wf.status === 'COMPLETED') {
    return { ...base, state: 'done', attempt: 1 };
  }

  // Terminal and not completed. A revoked caller lands here, and the reason is
  // in history rather than in the description, so it costs one fetch.
  const detail = await reader.failureMessage(wf.workflowId);
  return {
    ...base,
    state: looksDenied(detail) ? 'denied' : 'failed',
    attempt: 1,
    detail,
  };
}

/** The instructor types a bare namespace name; the data plane wants the full id. */
export function resolveDeskNamespace(deskNamespace: string): string {
  const trimmed = deskNamespace.trim();
  return trimmed.includes('.') ? trimmed : `${trimmed}.${config().TRAINING_ACCOUNT_ID}`;
}

/**
 * The reviews currently parked on a human, discovered rather than tracked.
 *
 * Each RUNNING `ReviewWorkflow` is asked its `pending` Query, which answers with
 * the adjudicator's question or null. A Query needs a live Worker, so this
 * returns nothing at all while the desk is stopped for round 4 — correctly: you
 * cannot approve an escalation on a desk that is not running, and the parked
 * review is still there when it comes back.
 */
export async function readEscalations(deskNamespace: string): Promise<DeskEscalation[]> {
  const reader = await namespaceReader(resolveDeskNamespace(deskNamespace));
  if (!reader) return [];

  const running = await reader.listWorkflows(
    `WorkflowType = "${HANDLER_WORKFLOW_TYPE}" AND ExecutionStatus = "Running"`,
    ESCALATION_LIMIT,
  );

  const asked = await mapWithLimit<
    (typeof running)[number],
    DeskEscalation | undefined
  >(running, QUERY_CONCURRENCY, async (wf) => {
    const question = await reader.queryText(wf.workflowId, 'pending');
    if (!question) return undefined;
    return {
      workflowId: wf.workflowId,
      caller: wf.workflowId.replace(/^review-/, ''),
      question,
      startedAtMs: wf.startedAtMs,
    };
  });

  return asked
    .filter((e): e is DeskEscalation => e !== undefined)
    .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
}

/**
 * Clear one escalation. The instructor-screen equivalent of
 * `uv run --group desk lab4_review.py decide <id> approve`.
 *
 * The desk's workflow has been parked on `wait_condition`, possibly for minutes:
 * this Signal is the whole of what un-parks it, and the caller — who never knew a
 * person was involved — simply has its result a moment later.
 */
export async function decideEscalation(
  deskNamespace: string,
  workflowId: string,
  outcome: 'approve' | 'decline',
  note: string,
  by: string,
): Promise<void> {
  await signalHumanDecision(resolveDeskNamespace(deskNamespace), workflowId, {
    outcome,
    note,
    by,
  });
}

export async function readSwitchboard(deskNamespace: string): Promise<SwitchboardState> {
  const cfg = config();
  const warnings: string[] = [];

  const desk = resolveDeskNamespace(deskNamespace);

  let candidates: string[] = [];
  try {
    const all = await listNamespaces();
    candidates = all
      .map((n) => n.namespace ?? '')
      .filter((id) => id.startsWith(cfg.LAB_NAMESPACE_PREFIX) && id !== desk);
  } catch (err) {
    warnings.push(
      `Could not list namespaces: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const [results, escalations] = await Promise.all([
    mapWithLimit(candidates, CONCURRENCY, readCaller),
    // A desk namespace that cannot be read is not fatal: the ring is built from
    // the callers, and an escalation queue that is briefly unavailable — because
    // the desk is stopped — is a true statement about the desk.
    readEscalations(desk).catch((err) => {
      warnings.push(
        `Could not read the desk's escalation queue: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [] as DeskEscalation[];
    }),
  ]);
  const callers = results.filter((c): c is SwitchboardCaller => c !== undefined);

  // Arrival order. This, not the desk's own counter, is the authoritative
  // sequence — the counter in labs/worker is a process-local toy and says so.
  callers.sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));

  return {
    atMs: Date.now(),
    deskNamespace: desk,
    callers,
    silent: candidates.length - callers.length,
    escalations,
    warnings,
  };
}
