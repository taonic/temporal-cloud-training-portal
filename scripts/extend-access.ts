/**
 * Extends the students who still have access, out to an absolute instant.
 *
 *   pnpm ops:extend                                  # dry run: prints the plan, changes nothing
 *   pnpm ops:extend --commit                         # to the end of this month, PORTAL_LINK_TIMEZONE
 *   pnpm ops:extend --until=2026-09-15T18:00+10:00 --commit
 *   pnpm ops:extend --email=a@acme.com --commit      # repeatable; default is everyone
 *
 * Extending a student is TWO writes, and doing one without the other is worse
 * than doing neither:
 *
 *   1. the registry's ACCESS WINDOW, which is what the sweeper reads. Move only
 *      the revoke timer and the window still closes on the original schedule,
 *      at which point every namespace the student built dates inside a closed
 *      window — the exact condition `sweepOnce` deletes on. They would keep
 *      Global Admin and lose their work. Windows move first, for that reason.
 *   2. the invitation workflow's revoke timer, via the `extendMs` signal.
 *
 * Idempotent: both halves are computed as a delta against the CURRENT deadline
 * rather than a fixed offset, so running it twice is a no-op rather than two
 * months of access.
 *
 * Reads .env.local / .env exactly as the Next server does. Requires the worker
 * to be running the current workflow code — the registry only gains the
 * extendWindows handler once it has replayed against a deployed worker.
 */
import { config } from '../src/config';
import { endOfMonthAt } from '../src/invite/link';
import { extendAccess, extendWindows, getInvitationState, getTemporalClient } from '../src/temporal/client';
import { NAMES, REGISTRY_WORKFLOW_ID, type InvitationState, type RegistryState } from '../src/temporal/shared';

let failures = 0;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => {
  console.log(`  ✗ ${m}`);
  failures++;
};
const warn = (m: string) => console.log(`  ! ${m}`);
const skip = (m: string) => console.log(`  – ${m}`);

/**
 * Walks the `cause` chain. Temporal wraps the useful part — "query handler not
 * registered", "workflow not found", a gRPC status — inside a generic outer
 * message like "Failed to query Workflow", and printing only the outer one
 * tells an operator nothing they can act on.
 */
function reason(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  while (cur instanceof Error && parts.length < 4) {
    if (!parts.includes(cur.message)) parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(' ← ') : String(err);
}

/** Only 'active' and 'inviting' still own a revoke timer that can be moved. */
const EXTENDABLE: InvitationState['status'][] = ['active', 'inviting'];

interface Plan {
  email: string;
  windowEndMs: number;
  state?: InvitationState;
  /** Delta to add to the workflow's expiry. Present only when action is 'extend'. */
  extraMs?: number;
  why?: string;
}

function parseArgs(argv: string[]) {
  let until: string | undefined;
  let commit = false;
  const emails: string[] = [];

  for (const arg of argv) {
    if (arg === '--commit') commit = true;
    else if (arg.startsWith('--until=')) until = arg.slice('--until='.length);
    else if (arg.startsWith('--email=')) emails.push(arg.slice('--email='.length).trim().toLowerCase());
    else throw new Error(`unrecognised argument ${arg} — see the header of scripts/extend-access.ts`);
  }
  return { until, commit, emails };
}

async function main() {
  const cfg = config();
  const { until, commit, emails } = parseArgs(process.argv.slice(2));
  const tz = cfg.PORTAL_LINK_TIMEZONE;

  const at = (ms: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));

  const forMs = (ms: number) => {
    const hours = ms / 3_600_000;
    return hours < 48 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
  };

  const now = Date.now();

  /* -- Target instant ---------------------------------------------------- */
  let target: Date;
  if (until) {
    target = new Date(until);
    if (Number.isNaN(target.getTime())) {
      bad(`--until=${until} is not a date I can parse. Use an ISO 8601 value with an offset.`);
      process.exit(1);
    }
    // Without an offset, `new Date()` reads a bare "2026-09-15T18:00" as the
    // LOCAL zone of whoever runs this, which is not necessarily the workshop's.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(until)) {
      warn(`--until has no UTC offset, so it was read in this machine's local zone, not ${tz}`);
    }
  } else {
    target = endOfMonthAt(new Date(now), tz);
  }
  const targetMs = target.getTime();

  console.log(`\nExtending to ${at(targetMs)} (${tz}) — ${target.toISOString()}`);
  if (!until) ok('end of the current month, the default');
  if (targetMs <= now) {
    bad('that instant is in the past — nothing would be extended');
    console.log('');
    process.exit(1);
  }

  /* -- Who still has access ---------------------------------------------- */
  console.log(`\nOpen access windows`);
  // Queried directly rather than through getRegistryState(), which swallows the
  // error and returns undefined — right for a web page that degrades, useless
  // for an operator who needs to know whether this is auth, the wrong
  // namespace, or a registry that was never started.
  let registry: RegistryState;
  try {
    const client = await getTemporalClient();
    registry = await client.workflow
      .getHandle(REGISTRY_WORKFLOW_ID)
      .query<RegistryState>(NAMES.registryState);
  } catch (err) {
    bad(
      `could not read the registry (${REGISTRY_WORKFLOW_ID}): ${reason(err)}\n` +
        `      Checked ${cfg.TEMPORAL_NAMESPACE} at ${cfg.TEMPORAL_ADDRESS}. ` +
        `\`pnpm ops:preflight\` verifies the connection and the credential.`,
    );
    console.log('');
    process.exit(1);
  }

  // One window per address: the seat request is idempotent while a window is
  // open, so a student can have at most one. Older CLOSED windows are left
  // alone — see the handler comment in workflows/registry.ts.
  const open = registry.windows
    .filter((w) => w.endMs > now)
    .filter((w) => emails.length === 0 || emails.includes(w.email))
    .sort((a, b) => a.endMs - b.endMs);

  if (open.length === 0) {
    skip(
      emails.length > 0
        ? 'none of those addresses has an open window (already expired students re-request the link)'
        : 'nobody currently has access, so there is nothing to extend',
    );
    console.log('');
    process.exit(0);
  }
  ok(`${open.length} student${open.length === 1 ? '' : 's'} with access`);

  if (emails.length > 0) {
    const missing = emails.filter((e) => !open.some((w) => w.email === e));
    for (const email of missing) warn(`${email}: no open window, skipping`);
  }

  /* -- Plan -------------------------------------------------------------- */
  const plans: Plan[] = [];
  for (const window of open) {
    const state = await getInvitationState(window.email);
    const plan: Plan = { email: window.email, windowEndMs: window.endMs, state };

    if (!state) {
      // Window open but no workflow to query: it has completed and been
      // reaped, or was never started. Moving the window alone would only
      // protect leftovers from a student who no longer has access.
      plan.why = 'invitation workflow not found';
    } else if (!EXTENDABLE.includes(state.status)) {
      plan.why = `status is ${state.status}`;
    } else if (state.expiresAtMs >= targetMs) {
      plan.why = `already runs to ${at(state.expiresAtMs)}`;
    } else {
      plan.extraMs = targetMs - state.expiresAtMs;
    }
    plans.push(plan);
  }

  const toExtend = plans.filter((p) => p.extraMs !== undefined);

  console.log(`\nPlan`);
  for (const p of plans) {
    const label = `${p.email.padEnd(34)} expires ${at(p.state?.expiresAtMs ?? p.windowEndMs)}`;
    if (p.extraMs === undefined) skip(`${label}  — ${p.why}`);
    else ok(`${label}  → ${at(targetMs)}  (+${forMs(p.extraMs)})`);
  }

  if (toExtend.length === 0) {
    console.log(`\nNothing to do.\n`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /* -- Consequences ------------------------------------------------------ */
  console.log(`\nWhat this changes`);
  warn(
    `${toExtend.length} student${toExtend.length === 1 ? '' : 's'} keep Global Admin on ` +
      `${cfg.TRAINING_ACCOUNT_ID} until ${at(targetMs)} — able to delete the identity behind ` +
      `CLOUD_OPS_API_KEY for that whole period`,
  );
  warn(
    `the sweeper will not reclaim their namespaces until ${at(targetMs)} plus the 7-day window ` +
      `retention, so training- resources accumulate until then`,
  );
  if (cfg.SWEEPER_MODE === 'dry-run') {
    skip('SWEEPER_MODE=dry-run, so nothing is being deleted either way right now');
  }

  if (!commit) {
    console.log(`\nDry run — nothing was changed. Re-run with --commit to apply.\n`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /* -- Apply: windows first, then timers --------------------------------- */
  console.log(`\nExtending access windows (sweeper's view)`);
  try {
    const result = await extendWindows({
      untilMs: targetMs,
      emails: toExtend.map((p) => p.email),
    });
    ok(`${result.extended.length} window${result.extended.length === 1 ? '' : 's'} moved`);
    for (const email of result.unchanged) skip(`${email}: window already ran past the target`);
  } catch (err) {
    bad(
      `could not extend windows: ${reason(err)}\n` +
        `      If this says the update handler is unknown, the worker is still running older ` +
        `workflow code — deploy it and re-run. NO timers were touched, so nothing is inconsistent.`,
    );
    console.log('');
    process.exit(1);
  }

  console.log(`\nExtending revoke timers (students' access)`);
  for (const p of toExtend) {
    try {
      await extendAccess(p.email, p.extraMs!);
      ok(`${p.email} → ${at(targetMs)}`);
    } catch (err) {
      bad(`${p.email}: signal failed — ${reason(err)}`);
    }
  }

  if (failures > 0) {
    warn(
      'the failures above leave a window open longer than that student\'s access, which only ' +
        'means the sweeper waits before reclaiming their resources. Re-run to retry — the deltas ' +
        'are recomputed from current state, so nobody gets extended twice.',
    );
  }

  console.log(
    failures === 0 ? `\nExtended ${toExtend.length}.\n` : `\nFinished with ${failures} failure(s).\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nExtend could not run: ${reason(err)}\n`);
  process.exit(1);
});
