/**
 * Create the Risk Desk endpoint and keep its caller allowlist matching the room.
 *
 *   pnpm ops:setup-nexus-endpoint <desk-namespace> [flags]
 *
 * A Nexus Endpoint permits NO callers by default — not even namespaces in the
 * same account as its target. So the allowlist has to name every student
 * namespace, and it cannot be written before the workshop starts, because those
 * namespaces do not exist until each student applies Lab 1.
 *
 * WHY IT WATCHES RATHER THAN RUNS ONCE. The roster is not a thing that settles.
 * Students finish Lab 1 minutes apart, someone re-runs it under a different name,
 * a latecomer arrives during the Nexus segment — and every one of those is a
 * person whose call is refused at the boundary until somebody remembers to re-run
 * a command. So this now polls every 5 seconds and reconciles: a namespace that
 * appears is allowed within seconds, without you leaving the slide you are on.
 * Start it after Session 1 begins and leave it running in a spare terminal;
 * Ctrl-C when the segment is over. `--once` is the old one-shot behaviour.
 *
 * IDEMPOTENT, and in the strong sense rather than the "safe to re-run" sense.
 * Each pass computes the spec the endpoint SHOULD have, compares it with what the
 * endpoint HAS, and calls nothing at all when they already agree. That is what
 * makes a 5-second loop reasonable: a steady state is two reads and no writes,
 * and the terminal stays silent until something actually changes.
 *
 * Deliberately NOT Terraform. The endpoint is a live classroom control — you add
 * a latecomer mid-session and revoke a volunteer in round 2 — and a plan/apply
 * cycle is the wrong instrument for something you change while talking. It is
 * also account-global, so a state file that thinks it owns it is a liability the
 * moment anyone touches the endpoint from the UI.
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

/** Watch cadence. Two reads per pass, and no writes unless the roster moved. */
const DEFAULT_INTERVAL_SECONDS = 5;

/**
 * Consecutive failures tolerated before the watch gives up.
 *
 * A single failed pass is usually a blip — a rate limit, a dropped connection —
 * and killing the loop for one would defeat the point of leaving it running. A
 * credential that has expired or a role that cannot manage the endpoint fails
 * every time, and a terminal that scrolls the same error forever is worse than
 * one that stops and says why.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const has = (name: string) => process.argv.includes(`--${name}`);

function qualify(name: string, account: string): string {
  return name.includes('.') ? name : `${name}.${account}`;
}

/** Wall-clock, so a change in the scrollback can be matched to what was on screen. */
const clock = () => new Date().toTimeString().slice(0, 8);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * costs a few seconds and removes an entire category of "it did not work". The
 * watch loop pauses while this waits, which is correct — there is nothing worth
 * reconciling against a change that has not landed yet.
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
    await sleep(OPERATION_POLL_MS);
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

  It WATCHES by default: every ${DEFAULT_INTERVAL_SECONDS}s it re-reads the account and allows any
  new lab namespace. Leave it running through Session 1 and the Nexus segment,
  Ctrl-C when you are done. The endpoint is not touched on the way out.

  Flags:
    --once              One pass, then exit. The old behaviour.
    --interval <sec>    Poll cadence for the watch (default ${DEFAULT_INTERVAL_SECONDS}).
    --dry-run           Show what would change and call nothing. Implies --once.
    --revoke <ns>       Round 2: keep this caller OFF the allowlist. The watch
                        re-applies it every pass, so it stays revoked.
    --allow <ns>        Add a caller that does not match the lab prefix.
    --no-wait           Return as soon as the API accepts, without waiting
                        for the change to reach the data plane.
`);
  process.exit(1);
}

interface Options {
  deskId: string;
  revoked?: string;
  extra?: string;
  dryRun: boolean;
  noWait: boolean;
  once: boolean;
  intervalMs: number;
}

/** What a pass has already said, so the watch does not repeat itself. */
interface WatchState {
  first: boolean;
  /** Printed once, not every 5 seconds, while the room is still on Lab 1. */
  saidWaiting: boolean;
  /** Printed once when the endpoint is already correct on startup. */
  saidCorrect: boolean;
}

/**
 * One reconcile pass: read the account, compute the allowlist, make the endpoint
 * match. Returns nothing and prints only what changed — in a loop, silence is the
 * signal that the roster is stable.
 */
async function reconcile(
  cfg: ReturnType<typeof config>,
  opts: Options,
  state: WatchState,
): Promise<void> {
  const [namespaces, endpoints] = await Promise.all([listNamespaces(), listNexusEndpoints()]);

  // The lab prefix is the only marker a student namespace carries, and it is the
  // same one the sweeper trusts.
  const discovered = namespaces
    .map((n) => n.namespace ?? '')
    .filter((id) => id.startsWith(cfg.LAB_NAMESPACE_PREFIX) && id !== opts.deskId);

  const callers = [...new Set([...discovered, ...(opts.extra ? [opts.extra] : [])])]
    .filter((id) => id !== opts.revoked)
    .sort();

  const existing = endpoints.find((e) => e.spec?.name === ENDPOINT);
  const deskExists = namespaces.some((n) => n.namespace === opts.deskId);

  if (state.first) {
    console.log(`\n  Account ${cfg.TRAINING_ACCOUNT_ID} · endpoint "${ENDPOINT}" → ${opts.deskId}`);
    if (!deskExists) {
      console.log(`  ! ${opts.deskId} is not in this account. Create it before the endpoint —`);
      console.log('    the target namespace must exist, and you need Namespace Admin on it.');
    }
    console.log(`  ${callers.length} caller namespace(s) matching "${cfg.LAB_NAMESPACE_PREFIX}*"`);
    if (opts.revoked) console.log(`  ! ${opts.revoked} deliberately excluded (--revoke)`);
    for (const id of callers) console.log(`    · ${id}`);
  }

  if (!callers.length) {
    // Creating an endpoint that permits nobody is legal and useless, and it
    // would make the next pass an update rather than a create for no gain.
    if (!state.saidWaiting) {
      state.saidWaiting = true;
      console.log('\n  Nothing to allow yet. Students create their namespaces in Session 1;');
      console.log(
        opts.once
          ? '  run this again once the room has applied Lab 1.\n'
          : '  watching — each one is allowed within seconds of appearing.\n',
      );
    }
    return;
  }
  state.saidWaiting = false;

  const desired = nexusEndpointSpec({
    name: ENDPOINT,
    targetNamespaceId: opts.deskId,
    targetTaskQueue: TASK_QUEUE,
    allowedNamespaceIds: callers,
  });

  /* -- The idempotent core ------------------------------------------------- */

  if (existing && sameSpec(desired, existing.spec as NexusEndpointSpec)) {
    if (!state.saidCorrect) {
      state.saidCorrect = true;
      console.log(
        opts.once
          ? '\n  Already correct. Nothing to do.\n'
          : `\n  Already correct — ${callers.length} caller(s). Watching for new namespaces.\n`,
      );
    }
    return;
  }
  state.saidCorrect = false;

  if (existing) {
    const before = currentCallers(existing.spec as NexusEndpointSpec);
    const added = callers.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !callers.includes(id));
    console.log(`\n  ${clock()}  endpoint exists (${existing.id}). Updating:`);
    for (const id of added) console.log(`    + ${id}`);
    for (const id of removed) console.log(`    - ${id}`);
    if (!added.length && !removed.length) console.log('    · target or task queue changed');

    if (opts.dryRun) {
      console.log('\n  --dry-run: nothing sent.\n');
      return;
    }

    const operation = await updateNexusEndpoint({
      endpointId: existing.id,
      spec: desired,
      resourceVersion: existing.resource_version,
      asyncOperationId: randomUUID(),
    });
    const status = opts.noWait ? 'submitted' : await awaitOperation(operation?.id);
    console.log(`  ${clock()}  allowlist set to ${callers.length} caller(s) — ${status}.\n`);
    return;
  }

  console.log(`\n  ${clock()}  endpoint does not exist. Creating it with the roster above.`);
  if (opts.dryRun) {
    console.log('\n  --dry-run: nothing sent.\n');
    return;
  }

  const { endpointId, operation } = await createNexusEndpoint({
    spec: desired,
    asyncOperationId: randomUUID(),
  });
  const status = opts.noWait ? 'submitted' : await awaitOperation(operation?.id);
  console.log(`  ${clock()}  created ${endpointId ?? ENDPOINT} — ${status}.\n`);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function permissionHint(message: string): void {
  if (/permission|denied/i.test(message)) {
    console.error('  Managing an endpoint needs Developer role or higher, PLUS Namespace Admin');
    console.error('  on the TARGET namespace. Reading the account is not enough.\n');
  } else {
    console.error('');
  }
}

async function main() {
  const cfg = config();
  const desk = process.argv[2];
  if (!desk || desk.startsWith('--')) usage(cfg.TRAINING_ACCOUNT_ID);

  const intervalSeconds = Number(flag('interval') ?? DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error(`\n  --interval must be a positive number of seconds, got "${flag('interval')}".\n`);
    process.exit(1);
  }

  const dryRun = has('dry-run');
  const opts: Options = {
    deskId: qualify(desk, cfg.TRAINING_ACCOUNT_ID),
    revoked: flag('revoke') ? qualify(flag('revoke')!, cfg.TRAINING_ACCOUNT_ID) : undefined,
    extra: flag('allow') ? qualify(flag('allow')!, cfg.TRAINING_ACCOUNT_ID) : undefined,
    dryRun,
    noWait: has('no-wait'),
    // Nothing is sent in a dry run, so a loop would print the same diff forever.
    once: has('once') || dryRun,
    intervalMs: intervalSeconds * 1000,
  };

  const state: WatchState = { first: true, saidWaiting: false, saidCorrect: false };

  if (opts.once) {
    await reconcile(cfg, opts, state);
    return;
  }

  // Ctrl-C is the intended way out, so say what it leaves behind: the endpoint
  // stays exactly as the last pass set it, and callers keep working.
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('\n  Stopped watching. The endpoint and its allowlist are unchanged by this.\n');
    process.exit(0);
  });

  console.log(`\n  Watching every ${intervalSeconds}s. Ctrl-C to stop.`);

  let failures = 0;
  while (!stopping) {
    try {
      await reconcile(cfg, opts, state);
      state.first = false;
      failures = 0;
    } catch (err) {
      const message = describe(err);
      failures += 1;
      console.error(`  ${clock()}  pass failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${message}`);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n  Giving up after ${failures} consecutive failures.`);
        permissionHint(message);
        process.exit(1);
      }
    }
    await sleep(opts.intervalMs);
  }
}

main().catch((err) => {
  const message = describe(err);
  console.error(`\n  Failed: ${message}`);
  permissionHint(message);
  process.exit(1);
});
