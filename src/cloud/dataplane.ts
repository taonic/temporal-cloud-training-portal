import { Client, Connection } from '@temporalio/client';
import { config } from '@/config';

/**
 * Read-only access to a student's own namespace, for grading the parts of
 * Sessions 1, 4 and 6 that the Cloud Ops API cannot see — worker deployments,
 * task queue pollers, whether a workflow actually completed.
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
        });
        if (out.length >= limit) break;
      }
      return out;
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
