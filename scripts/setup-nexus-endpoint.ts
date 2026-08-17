/**
 * Create the Risk Desk endpoint and set its caller allowlist to whoever exists.
 *
 *   pnpm ops:setup-nexus-endpoint <desk-namespace> [flags]
 *
 * A Nexus Endpoint permits NO callers by default — not even namespaces in the
 * same account as its target. So the allowlist has to name every student
 * namespace, and it cannot be written before the workshop starts, because those
 * namespaces do not exist until each student applies Lab 1. This script closes
 * that gap: it reads the account, finds the lab namespaces, and makes the
 * endpoint match — creating it the first time, updating it every time after.
 *
 * IDEMPOTENT, and in the strong sense rather than the "safe to re-run" sense.
 * It computes the spec the endpoint SHOULD have, compares it with what the
 * endpoint HAS, and calls nothing at all when they already agree. Run it in a
 * loop and the second run is a read. That matters more than convenience here:
 * this is a command you run mid-session with a room watching, sometimes twice
 * because you forgot whether the first one took, and an update that always
 * fires is an update that can always fail.
 *
 * Deliberately NOT Terraform. The endpoint is a live classroom control — you add
 * a latecomer mid-session and revoke a volunteer in round 2 — and a plan/apply
 * cycle is the wrong instrument for something you change while talking. It is
 * also account-global, so a state file that thinks it owns it is a liability the
 * moment anyone touches the endpoint from the UI.
 *
 * Run it after the room has finished Session 1 and before the Nexus segment.
 * Re-run it whenever the roster changes.
 *
 * Reads .env.local / .env exactly as the portal does, so it sees the same
 * account the portal grades against.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../src/config';
import {
  createNexusEndpoint,
  getAsyncOperation,
  listNamespaces,
  listNexusEndpoints,
  nexusEndpointSpec,
  updateNexusEndpoint,
  type NexusEndpointSpec,
} from '../src/cloud/ops';

const ENDPOINT = process.env.NEXUS_ENDPOINT ?? 'risk-desk';
const TASK_QUEUE = 'risk-desk';

/** How long to wait for the endpoint to go live before reporting it as pending. */
const OPERATION_TIMEOUT_MS = 60_000;
const OPERATION_POLL_MS = 2_000;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const has = (name: string) => process.argv.includes(`--${name}`);

function qualify(name: string, account: string): string {
  return name.includes('.') ? name : `${name}.${account}`;
}

/** The allowlist as the endpoint currently holds it, sorted for comparison. */
function currentCallers(spec: NexusEndpointSpec | undefined): string[] {
  const policies = (spec as any)?.policy_specs ?? [];
  return policies
    .map((p: any) => p?.allowed_cloud_namespace_policy_spec?.namespace_id ?? '')
    .filter(Boolean)
    .sort();
}

function sameSpec(a: NexusEndpointSpec, b: NexusEndpointSpec | undefined): boolean {
  if (!b) return false;
  const target = (spec: any) => spec?.target_spec?.worker_target_spec ?? {};
  return (
    (a as any).name === (b as any).name &&
    target(a).namespace_id === target(b).namespace_id &&
    target(a).task_queue === target(b).task_queue &&
    JSON.stringify(currentCallers(a)) === JSON.stringify(currentCallers(b))
  );
}

/**
 * Wait for the create/update to reach the data plane.
 *
 * Cloud applies these asynchronously, and the gap is the thing that bites in a
 * classroom: the API returns immediately, you tell the room to call, and the
 * first few get refused because the allowlist has not propagated. Blocking here
 * costs a few seconds and removes an entire category of "it did not work".
 */
async function awaitOperation(id: string | undefined): Promise<string> {
  if (!id) return 'no operation returned';
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const op = await getAsyncOperation(id).catch(() => undefined);
    const state = op?.state ?? '';
    if (state.endsWith('FULFILLED')) return 'live';
    if (state.endsWith('FAILED')) {
      throw new Error(`operation ${id} failed: ${op?.failure_reason ?? 'no reason given'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS));
  }
  return `still pending after ${OPERATION_TIMEOUT_MS / 1000}s — check the Cloud UI`;
}

function usage(account: string): never {
  console.error(`
  Usage: pnpm ops:setup-nexus-endpoint <desk-namespace> [flags]

  The desk namespace is the endpoint's TARGET — the one your handler worker
  polls, and the one you type into the instructor dashboard on the day. Pass it
  fully qualified or bare; both work:

      pnpm ops:setup-nexus-endpoint risk-desk-ns
      pnpm ops:setup-nexus-endpoint risk-desk-ns.${account}

  Flags:
    --dry-run           Show what would change and call nothing.
    --revoke <ns>       Round 2: leave this caller OFF the allowlist.
    --allow <ns>        Add a caller that does not match the lab prefix.
    --no-wait           Return as soon as the API accepts, without waiting
                        for the change to reach the data plane.
`);
  process.exit(1);
}

async function main() {
  const cfg = config();
  const desk = process.argv[2];
  if (!desk || desk.startsWith('--')) usage(cfg.TRAINING_ACCOUNT_ID);

  const deskId = qualify(desk, cfg.TRAINING_ACCOUNT_ID);
  const revoked = flag('revoke') ? qualify(flag('revoke')!, cfg.TRAINING_ACCOUNT_ID) : undefined;
  const extra = flag('allow') ? qualify(flag('allow')!, cfg.TRAINING_ACCOUNT_ID) : undefined;
  const dryRun = has('dry-run');

  const [namespaces, endpoints] = await Promise.all([listNamespaces(), listNexusEndpoints()]);

  // The lab prefix is the only marker a student namespace carries, and it is the
  // same one the sweeper trusts.
  const discovered = namespaces
    .map((n) => n.namespace ?? '')
    .filter((id) => id.startsWith(cfg.LAB_NAMESPACE_PREFIX) && id !== deskId);

  const callers = [...new Set([...discovered, ...(extra ? [extra] : [])])]
    .filter((id) => id !== revoked)
    .sort();

  const existing = endpoints.find((e) => e.spec?.name === ENDPOINT);
  const deskExists = namespaces.some((n) => n.namespace === deskId);

  console.log(`\n  Account ${cfg.TRAINING_ACCOUNT_ID} · endpoint "${ENDPOINT}" → ${deskId}`);
  if (!deskExists) {
    console.log(`  ! ${deskId} is not in this account. Create it before the endpoint —`);
    console.log('    the target namespace must exist, and you need Namespace Admin on it.');
  }
  console.log(`  ${callers.length} caller namespace(s) matching "${cfg.LAB_NAMESPACE_PREFIX}*"`);
  if (revoked) console.log(`  ! ${revoked} deliberately excluded (--revoke)`);
  for (const id of callers) console.log(`    · ${id}`);

  if (!callers.length) {
    console.log('\n  Nothing to allow yet. Students create their namespaces in Session 1 —');
    console.log('  run this again once the room has applied Lab 1.\n');
    // Creating an endpoint that permits nobody is legal and useless, and it
    // would make the next run an update rather than a create for no gain.
    return;
  }

  const desired = nexusEndpointSpec({
    name: ENDPOINT,
    targetNamespaceId: deskId,
    targetTaskQueue: TASK_QUEUE,
    allowedNamespaceIds: callers,
  });

  /* -- The idempotent core ------------------------------------------------- */

  if (existing && sameSpec(desired, existing.spec as NexusEndpointSpec)) {
    console.log('\n  Already correct. Nothing to do.\n');
    return;
  }

  if (existing) {
    const before = currentCallers(existing.spec as NexusEndpointSpec);
    const added = callers.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !callers.includes(id));
    console.log(`\n  Endpoint exists (${existing.id}). Updating:`);
    for (const id of added) console.log(`    + ${id}`);
    for (const id of removed) console.log(`    - ${id}`);
    if (!added.length && !removed.length) console.log('    · target or task queue changed');

    if (dryRun) return console.log('\n  --dry-run: nothing sent.\n');

    const operation = await updateNexusEndpoint({
      endpointId: existing.id,
      spec: desired,
      resourceVersion: existing.resource_version,
      asyncOperationId: randomUUID(),
    });
    const status = has('no-wait') ? 'submitted' : await awaitOperation(operation?.id);
    console.log(`\n  Allowlist set — ${status}.\n`);
    return;
  }

  console.log('\n  Endpoint does not exist. Creating it with the roster above.');
  if (dryRun) return console.log('\n  --dry-run: nothing sent.\n');

  const { endpointId, operation } = await createNexusEndpoint({
    spec: desired,
    asyncOperationId: randomUUID(),
  });
  const status = has('no-wait') ? 'submitted' : await awaitOperation(operation?.id);
  console.log(`\n  Created ${endpointId ?? ENDPOINT} — ${status}.\n`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  Failed: ${message}`);
  if (/permission|denied/i.test(message)) {
    console.error('  Managing an endpoint needs Developer role or higher, PLUS Namespace Admin');
    console.error('  on the TARGET namespace. Reading the account is not enough.\n');
  } else {
    console.error('');
  }
  process.exit(1);
});
