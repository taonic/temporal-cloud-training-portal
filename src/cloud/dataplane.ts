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

export interface DeploymentSummary {
  name: string;
  /** Build IDs currently tracked in the deployment. */
  versions: string[];
  /** Build ID currently receiving new executions, if any. */
  currentBuildId?: string;
}

export interface PayloadSample {
  workflowId: string;
  /** Distinct `encoding` values on the workflow's input payloads. */
  encodings: string[];
  /** Every distinct metadata key seen on those payloads, `encoding` included. */
  metadataKeys: string[];
}

export interface NamespaceReader {
  namespaceId: string;
  countWorkflows(query: string): Promise<number>;
  listWorkflows(query: string, limit?: number): Promise<WorkflowSummary[]>;
  pollerCount(taskQueue: string): Promise<number>;
  workerDeployment(name: string): Promise<DeploymentSummary | undefined>;
  /**
   * Reads the `encoding` metadata off recent workflows' input payloads.
   *
   * This is how Session 2 proves ciphertext-only egress rather than taking a
   * student's word for it: a payload sealed by temporal-proxy is tagged
   * `binary/encrypted`, an ordinary one `json/plain`. History is fetched raw,
   * with no data converter, so nothing here attempts to decrypt anything — and
   * nothing could, since the portal holds no key.
   */
  payloadEncodings(limit?: number): Promise<PayloadSample[]>;
  /** Pending Nexus Operations on one workflow. Empty once the call has resolved. */
  pendingNexusOperations(workflowId: string): Promise<PendingNexusOperation[]>;
  /**
   * What a workflow's history says about its Nexus operations.
   *
   * This is how Session 6 proves a call actually crossed a namespace boundary
   * rather than taking the student's word for it. `NexusOperationCompleted` in
   * the CALLER's history can only have been written by the caller's Nexus
   * Machinery after a handler in another namespace answered — the student cannot
   * fake it from their own side, and the grader never needs credentials for the
   * desk namespace to see it.
   */
  nexusOutcomes(query: string, limit?: number): Promise<NexusOutcome[]>;
  /** Why a closed workflow failed. Undefined if it did not, or if history is unreadable. */
  failureMessage(workflowId: string): Promise<string | undefined>;
}

/** Set by temporal-proxy on every payload it seals. */
export const ENCRYPTED_ENCODING = 'binary/encrypted';

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

    async pollerCount(taskQueue) {
      const res = await client.workflowService.describeTaskQueue({
        namespace: namespaceId,
        taskQueue: { name: taskQueue },
        // TASK_QUEUE_TYPE_WORKFLOW
        taskQueueType: 1,
      });
      return res.pollers?.length ?? 0;
    },

    async payloadEncodings(limit = 8) {
      const out: PayloadSample[] = [];
      const decoder = new TextDecoder();

      for await (const wf of client.workflow.list({
        query: 'ExecutionStatus = "Completed"',
      })) {
        if (out.length >= limit) break;
        try {
          // Raw history: no data converter runs, so payloads stay as bytes and
          // the metadata is readable even though the contents are not.
          const history = await client.workflow.getHandle(wf.workflowId).fetchHistory();
          const started = history.events?.find(
            (e) => e.workflowExecutionStartedEventAttributes != null,
          )?.workflowExecutionStartedEventAttributes;

          const encodings = new Set<string>();
          const metadataKeys = new Set<string>();
          for (const payload of started?.input?.payloads ?? []) {
            for (const key of Object.keys(payload.metadata ?? {})) metadataKeys.add(key);
            const raw = payload.metadata?.encoding;
            if (raw) encodings.add(decoder.decode(raw));
          }
          if (encodings.size > 0) {
            out.push({
              workflowId: wf.workflowId,
              encodings: [...encodings],
              metadataKeys: [...metadataKeys],
            });
          }
        } catch {
          // A single unreadable history should not fail the whole check.
        }
      }
      return out;
    },

    async workerDeployment(name) {
      try {
        const res = await client.workflowService.describeWorkerDeployment({
          namespace: namespaceId,
          deploymentName: name,
        });
        const info = res.workerDeploymentInfo;
        if (!info) return undefined;

        const versions = (info.versionSummaries ?? [])
          .map((v) => v.deploymentVersion?.buildId ?? v.version ?? '')
          .filter(Boolean);

        return {
          name: info.name ?? name,
          versions,
          currentBuildId:
            info.routingConfig?.currentDeploymentVersion?.buildId ??
            info.routingConfig?.currentVersion ??
            undefined,
        };
      } catch {
        // NOT_FOUND is the normal answer before the student runs a versioned
        // worker, and is indistinguishable from the feature being unavailable.
        return undefined;
      }
    },
  };
}
