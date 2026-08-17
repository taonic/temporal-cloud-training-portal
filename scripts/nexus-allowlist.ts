/**
 * Build the Rate Desk endpoint's caller allowlist from whoever actually exists.
 *
 *   pnpm ops:nexus-allowlist <desk-namespace>
 *
 * A Nexus Endpoint permits NO callers by default — not even namespaces in the
 * same account as its target. So the allowlist has to name every student
 * namespace, and it cannot be written before the workshop starts, because those
 * namespaces do not exist until each student applies Lab 1. This script closes
 * that gap: it reads the account, finds the lab namespaces, and prints the
 * `temporal cloud nexus endpoint` commands to paste.
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
import { config } from '../src/config';
import { listNamespaces } from '../src/cloud/ops';

const ENDPOINT = process.env.NEXUS_ENDPOINT ?? 'rate-desk';
const TASK_QUEUE = 'rate-desk';

async function main() {
  const cfg = config();
  const desk = process.argv[2];

  if (!desk) {
    console.error(`
  Usage: pnpm ops:nexus-allowlist <desk-namespace>

  The desk namespace is the endpoint's TARGET — the one your handler worker
  polls, and the one you type into the instructor dashboard on the day. Pass it
  fully qualified or bare; both work:

      pnpm ops:nexus-allowlist rate-desk
      pnpm ops:nexus-allowlist rate-desk.${cfg.TRAINING_ACCOUNT_ID}
`);
    process.exit(1);
  }

  const deskId = desk.includes('.') ? desk : `${desk}.${cfg.TRAINING_ACCOUNT_ID}`;
  const all = await listNamespaces();

  // The lab prefix is the only marker a student namespace carries, and it is the
  // same one the sweeper trusts.
  const callers = all
    .map((n) => n.namespace ?? '')
    .filter((id) => id.startsWith(cfg.LAB_NAMESPACE_PREFIX) && id !== deskId)
    .sort();

  const deskExists = all.some((n) => n.namespace === deskId);

  console.log(`\n  Account ${cfg.TRAINING_ACCOUNT_ID} · endpoint "${ENDPOINT}" → ${deskId}`);
  if (!deskExists) {
    console.log(`  ! ${deskId} is not in this account. Create it before the endpoint —`);
    console.log(`    the target namespace must exist, and you need Namespace Admin on it.`);
  }
  console.log(`  ${callers.length} caller namespace(s) matching "${cfg.LAB_NAMESPACE_PREFIX}*"\n`);

  if (!callers.length) {
    console.log('  Nothing to allow yet. Students create their namespaces in Session 1 —');
    console.log('  run this again once the room has applied Lab 1.\n');
    return;
  }

  for (const id of callers) console.log(`    · ${id}`);

  const allowFlags = callers.map((id) => `    --allow-namespace ${id}`).join(' \\\n');
  const nsFlags = callers.map((id) => `    --namespace ${id}`).join(' \\\n');

  console.log(`
  ── First time: create the endpoint ───────────────────────────────────────
  Needs Developer role or higher, plus Namespace Admin on the target.
  --idempotent makes this safe to re-run.

temporal cloud nexus endpoint create \\
    --name ${ENDPOINT} \\
    --target-namespace ${deskId} \\
    --target-task-queue ${TASK_QUEUE} \\
    --description 'RateDesk.quote — contract in labs/worker/training/rate_desk.py' \\
    --idempotent \\
${allowFlags}

  ── Afterwards: reset the allowlist to exactly this roster ────────────────
  "set" replaces the whole list, so this is both how you add a latecomer and
  how you put a revoked caller back after round 2.

temporal cloud nexus endpoint allowed-namespace set \\
    --name ${ENDPOINT} \\
${nsFlags}

  ── Round 2: revoke one caller, then restore ──────────────────────────────
  Pick a volunteer and remove just them. "add" puts them back without
  retyping the roster.

temporal cloud nexus endpoint allowed-namespace remove \\
    --name ${ENDPOINT} --namespace ${callers[Math.floor(callers.length / 2)]}

temporal cloud nexus endpoint allowed-namespace add \\
    --name ${ENDPOINT} --namespace ${callers[Math.floor(callers.length / 2)]}

  ── Check what the endpoint currently believes ────────────────────────────

temporal cloud nexus endpoint allowed-namespace list --name ${ENDPOINT}

  Propagation to the data plane usually takes under a minute, so make the
  revoke, then keep talking for a beat before you ask them to call again.
  Add --api-key "$TEMPORAL_API_KEY" to any of these to skip interactive login.
`);
}

main().catch((err) => {
  console.error(`\n  Failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
