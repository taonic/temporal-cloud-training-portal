import { Client, Connection } from '@temporalio/client';
import { config } from '@/config';

/**
 * Read-only access to a student's own namespace, for grading the parts of
 * Sessions 1, 4, 6 and 7 that the Cloud Ops API cannot see — worker deployments,
 * task queue pollers, Nexus operations crossing a namespace boundary, whether a
 * workflow actually completed.
 *
 * SECURITY NOTE. The portal authenticates with an Account Owner key, and
 * Account Owners hold Namespace *Admin* on every namespace in the account —
 * that is not revocable and not something the portal chose. So this credential
 * can terminate workflows, not merely read them.
 *
 * The only thing preventing that is this module: `NamespaceReader` exposes
 * reads and nothing else, and no other code is given the raw client. Keep it
 * that way. If a mutating call is ever needed, it should be an explicit,
 * separately named export so that it shows up in review.
 */

export interface WorkflowSummary {
  workflowId: string;
  status: string;
  buildId?: string;
  startedAtMs?: number;
  closedAtMs?: number;
}

/** What one workflow's history records about the Nexus operations it made. */
export interface NexusOutcome {
  workflowId: string;
  status: string;
  /** Endpoint names seen on `NexusOperationScheduled` events. */
  endpoints: string[];
  scheduled: number;
  /** Only async operations record Started; a sync one goes straight to Completed. */
  started: number;
  completed: number;
  failed: number;
  timedOut: number;
  canceled: number;
}

/**
 * A caller-side view of one pending Nexus Operation.
 *
 * This is the only place the interesting state of the Nexus segment lives. When
 * a handler is down the operation is retried by the caller's Nexus Machinery and
 * NO workflow exists in the handler namespace at all — so a screen that watches
 * only the handler sees nothing during an outage, which is precisely the moment
 * worth watching. `attempt` and `state` here are what make "queued, not lost"
 * visible.
 */
export interface PendingNexusOperation {
  endpoint?: string;
  service?: string;
  operation?: string;
  /** `Scheduled`, `BackingOff`, `Started` — server-side operation state. */
  state?: string;
  attempt: number;
  /** Message from the last failed attempt, if any. Carries permission denials. */
  lastFailure?: string;
}

export interface NamespaceReader {
  namespaceId: string;
  countWorkflows(query: string): Promise<number>;
  listWorkflows(query: string, limit?: number): Promise<WorkflowSummary[]>;
  pollerCount(taskQueue: string): Promise<number>;
  /** Pending Nexus Operations on one workflow. Empty once the call has resolved. */
  pendingNexusOperations(workflowId: string): Promise<PendingNexusOperation[]>;
  /**
   * What a workflow's history says about its Nexus operations.
   *
   * This is how Session 4 proves a call actually crossed a namespace boundary
   * rather than taking the student's word for it. `NexusOperationCompleted` in
   * the CALLER's history can only have been written by the caller's Nexus
   * Machinery after a handler in another namespace answered — the student cannot
   * fake it from their own side, and the grader never needs credentials for the
   * desk namespace to see it.
   */
  nexusOutcomes(query: string, limit?: number): Promise<NexusOutcome[]>;
  /** Why a closed workflow failed. Undefined if it did not, or if history is unreadable. */
  failureMessage(workflowId: string): Promise<string | undefined>;
  /**
   * A no-argument Query that answers with a string or null — the shape the Risk
   * Desk's `pending` Query uses to report what a review is waiting for.
   *
   * Undefined when the answer is null, when the workflow has closed, or when
   * nobody is polling the queue: a Query needs a live Worker, so a stopped desk
   * makes this unanswerable rather than empty. Callers must not read a failed
   * Query as "no escalation".
   */
  queryText(workflowId: string, queryName: string): Promise<string | undefined>;
}

/** How long a Query may take before the answer stops being worth waiting for. */
const QUERY_TIMEOUT_MS = 3_000;

/** One client per namespace, reused across checkpoints and across students' page loads. */
const clients = new Map<string, Promise<Client>>();

function connect(namespaceId: string): Promise<Client> {
  const cfg = config();
  const existing = clients.get(namespaceId);
  if (existing) return existing;

  const pending = (async () => {
    const connection = await Connection.connect({
      // The namespace endpoint is the recommended form and works with API keys.
      address: `${namespaceId}.tmprl.cloud:7233`,
      tls: true,
      apiKey: cfg.CLOUD_OPS_API_KEY,
      metadata: { 'temporal-namespace': namespaceId },
      connectTimeout: '10s',
    });
    return new Client({ connection, namespace: namespaceId });
  })();

  clients.set(namespaceId, pending);
  // Don't cache a failed connection — the namespace may simply not exist yet.
  pending.catch(() => clients.delete(namespaceId));
  return pending;
}

const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number((value as { toString(): string })?.toString() ?? 0);

/**
 * `PendingNexusOperationInfo.state` arrives as a NUMBER over this connection, not
 * as the enum name — verified against a real backing-off operation, which
 * reported `2`. An earlier version of this file assumed a string and called
 * `.replace()` on it, which threw inside the surrounding try/catch and silently
 * returned zero pending operations: the screen went blank at exactly the moment
 * it was meant to be interesting.
 *
 * Values are from `temporal.api.enums.v1.PendingNexusOperationState`. That enum
 * is not importable here — @temporalio/proto is transitive, not a direct
 * dependency — so it is transcribed, and both wire forms are handled in case a
 * future SDK starts sending names.
 */
const NEXUS_OP_STATE: Record<number, string> = {
  0: 'Unspecified',
  1: 'Scheduled',
  2: 'BackingOff',
  3: 'Started',
};

function nexusOpState(raw: unknown): string | undefined {
  if (typeof raw === 'number') return NEXUS_OP_STATE[raw] ?? `State${raw}`;
  if (typeof raw === 'string') {
    return raw.replace(/^PENDING_NEXUS_OPERATION_STATE_/, '').replace(/^NEXUS_OPERATION_STATE_/, '');
  }
  return undefined;
}

/**
 * The ONE write in this module, deliberately narrow and deliberately named so it
 * shows up in review — see the security note at the top of the file.
 *
 * It sends the Risk Desk's `decide` Signal to one parked `ReviewWorkflow` in the
 * instructor's own desk namespace, so the escalation in Session 4 round 3 can be
 * cleared from the instructor screen instead of from the terminal the desk is
 * printing to. The signal name and payload shape are fixed here rather than
 * passed in: this cannot be pointed at another signal, and it cannot terminate,
 * cancel or reset anything.
 *
 * `outcome` is narrowed by the type rather than validated, because a signal is
 * the last place a typo should reach — the desk reads the first letter of the
 * string, so `"aprove"` would silently approve a payment.
 */
export async function signalHumanDecision(
  namespaceId: string,
  workflowId: string,
  decision: { outcome: 'approve' | 'decline'; note?: string; by?: string },
): Promise<void> {
  const client = await connect(namespaceId);
  // The payload is the `HumanDecision` dataclass in labs/worker/training/
  // lab4_contract.py. Field names have to match: the desk deserialises by type
  // hint, and an unknown key or a missing one fails inside the workflow rather
  // than here.
  await client.workflow.getHandle(workflowId).signal('decide', {
    outcome: decision.outcome,
    note: decision.note ?? '',
    by: decision.by ?? 'instructor',
  });
}

/**
 * Returns undefined when the namespace cannot be reached — it may not exist
 * yet, or may have been created without API key authentication. Callers turn
 * that into a blocked checkpoint with a reason rather than an error.
 */
export async function namespaceReader(namespaceId: string): Promise<NamespaceReader | undefined> {
  let client: Client;
  try {
    client = await connect(namespaceId);
  } catch {
    return undefined;
  }

  return {
    namespaceId,

    async countWorkflows(query) {
      const res = await client.workflowService.countWorkflowExecutions({
        namespace: namespaceId,
        query,
      });
      return asNumber(res.count);
    },

    async listWorkflows(query, limit = 20) {
      const out: WorkflowSummary[] = [];
      for await (const wf of client.workflow.list({ query })) {
        out.push({
          workflowId: wf.workflowId,
          status: wf.status.name,
          startedAtMs: wf.startTime?.getTime(),
          closedAtMs: wf.closeTime?.getTime(),
        });
        if (out.length >= limit) break;
      }
      return out;
    },

    async pendingNexusOperations(workflowId) {
      try {
        const res = await client.workflowService.describeWorkflowExecution({
          namespace: namespaceId,
          execution: { workflowId },
        });
        return (res.pendingNexusOperations ?? []).map((op) => ({
          endpoint: op.endpoint ?? undefined,
          service: op.service ?? undefined,
          operation: op.operation ?? undefined,
          state: nexusOpState(op.state),
          attempt: asNumber(op.attempt),
          lastFailure: op.lastAttemptFailure?.message ?? undefined,
        }));
      } catch {
        // The workflow may have closed between the list and this call.
        return [];
      }
    },

    async nexusOutcomes(query, limit = 10) {
      const out: NexusOutcome[] = [];

      for await (const wf of client.workflow.list({ query })) {
        if (out.length >= limit) break;
        const row: NexusOutcome = {
          workflowId: wf.workflowId,
          status: wf.status.name,
          endpoints: [],
          scheduled: 0,
          started: 0,
          completed: 0,
          failed: 0,
          timedOut: 0,
          canceled: 0,
        };
        try {
          const history = await client.workflow.getHandle(wf.workflowId).fetchHistory();
          const endpoints = new Set<string>();
          for (const event of history.events ?? []) {
            const sched = event.nexusOperationScheduledEventAttributes;
            if (sched) {
              row.scheduled++;
              if (sched.endpoint) endpoints.add(sched.endpoint);
              continue;
            }
            if (event.nexusOperationStartedEventAttributes) row.started++;
            else if (event.nexusOperationCompletedEventAttributes) row.completed++;
            else if (event.nexusOperationFailedEventAttributes) row.failed++;
            else if (event.nexusOperationTimedOutEventAttributes) row.timedOut++;
            else if (event.nexusOperationCanceledEventAttributes) row.canceled++;
          }
          row.endpoints = [...endpoints];
        } catch {
          // An unreadable history should fail one row, not the whole check.
        }
        out.push(row);
      }
      return out;
    },

    async failureMessage(workflowId) {
      try {
        const history = await client.workflow.getHandle(workflowId).fetchHistory();
        for (const event of [...(history.events ?? [])].reverse()) {
          const failed = event.workflowExecutionFailedEventAttributes;
          if (failed?.failure) {
            // Walk to the innermost cause — the Nexus permission error sits
            // under a NexusOperationFailure wrapper.
            let f = failed.failure;
            while (f.cause) f = f.cause;
            return f.message ?? undefined;
          }
        }
      } catch {
        // Unreadable history should never take the screen down.
      }
      return undefined;
    },

    async queryText(workflowId, queryName) {
      try {
        // Deadline, not just a catch. A Query against a namespace whose Worker
        // has been stopped does not fail fast, and the caller here is a screen on
        // a four-second poll — during the Session 4 outage round every parked
        // review would otherwise hold the whole payload open. This is the round
        // the screen exists for, so it must stay responsive while it says
        // nothing.
        const answer = await client.withDeadline(Date.now() + QUERY_TIMEOUT_MS, () =>
          client.workflow.getHandle(workflowId).query<string | null>(queryName),
        );
        return answer ?? undefined;
      } catch {
        // A closed workflow, or no Worker polling the queue. Either way this is
        // "cannot tell", which the caller must not read as "nothing pending".
        return undefined;
      }
    },

    async pollerCount(taskQueue) {
      const res = await client.workflowService.describeTaskQueue({
        namespace: namespaceId,
        taskQueue: { name: taskQueue },
        // TASK_QUEUE_TYPE_WORKFLOW
        taskQueueType: 1,
      });
      return res.pollers?.length ?? 0;
    },


  };
}
