/**
 * Run this before the workshop, not on the morning of it.
 *
 *   pnpm ops:preflight
 *
 * Checks every assumption the portal makes that can only be verified against
 * the real accounts: the Cloud Ops credential and its role, the region the
 * Session 1 exit check demands, the namespace headroom the lab needs, and the
 * Temporal connection the whole thing runs on.
 *
 * Reads .env.local / .env exactly as the Next server does, so what this script
 * sees is what the running portal will see.
 */
import { config } from '../src/config';
import { getCurrentIdentity, listCustomRoles, listNamespaces, listRegions } from '../src/cloud/ops';

/** https://docs.temporal.io/cloud/limits#custom-role-limits */
const CUSTOM_ROLE_CAP = 25;
import {
  accountRoleOf,
  timestampToMs,
  type CloudApiKey,
  type CloudServiceAccount,
  type CloudUser,
} from '../src/cloud/types';
import { getTemporalClient } from '../src/temporal/client';
import { allowsAnyDomain, domainMatches, inviteUrl, nextRotationAt } from '../src/invite/link';

let failures = 0;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => {
  console.log(`  ✗ ${m}`);
  failures++;
};
const warn = (m: string) => console.log(`  ! ${m}`);
const skip = (m: string) => console.log(`  – ${m}`);

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Every check runs even when an earlier one failed — one run should surface every problem. */
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    bad(`${label}: ${reason(err)}`);
    return undefined;
  }
}

async function main() {
  const cfg = config();
  console.log(`\nConfiguration loaded from ${process.cwd()} (.env.local, .env, process.env)`);

  /* -- Cloud Ops credential --------------------------------------------- */
  console.log(`\nCloud Ops API — ${cfg.TRAINING_ACCOUNT_ID} (${cfg.CLOUD_OPS_ADDRESS})`);

  const identity = await attempt('authentication', () => getCurrentIdentity());

  if (!identity) {
    skip('role, key expiry, region and namespace checks need a working credential');
  } else {
    const principal: CloudUser | CloudServiceAccount | undefined =
      identity.user ?? identity.serviceAccount;
    const role = accountRoleOf(principal);
    const who = identity.user?.spec?.email ?? identity.serviceAccount?.spec?.name ?? 'unknown';

    ok(`authenticated as ${who} (${role ?? 'role unknown'})`);

    if (role === undefined) {
      bad('could not read the account role — cannot confirm this credential can invite users');
    } else if (role !== 'ROLE_OWNER' && role !== 'ROLE_ADMIN') {
      bad(`role ${role} cannot invite or delete users — needs ROLE_ADMIN or ROLE_OWNER`);
    } else if (role === 'ROLE_ADMIN') {
      warn('this credential is Global Admin, so a student with Global Admin can delete it');
    } else {
      ok('Account Owner — a student with Global Admin cannot delete you');
    }

    const apiKey: CloudApiKey | undefined = identity.apiKey;
    const expiry = timestampToMs(apiKey?.spec?.expiry_time);
    if (expiry === undefined) {
      warn('could not read API key expiry');
    } else {
      const days = Math.floor((expiry - Date.now()) / 86_400_000);
      if (days < 0) bad('the API key has already expired');
      else if (days < 7) bad(`the API key expires in ${days} day(s) — rotate before the workshop`);
      else ok(`API key valid for another ${days} days`);
    }

    /* -- Region ---------------------------------------------------------- */
    console.log(`\nRegion required by the Session 1 exit check`);
    const regions = await attempt('GetRegions', () => listRegions());
    if (regions) {
      if (regions.some((r) => r.id === cfg.LAB_REQUIRED_REGION)) {
        ok(`${cfg.LAB_REQUIRED_REGION} is available`);
      } else {
        bad(
          `${cfg.LAB_REQUIRED_REGION} is NOT available to this account. Available: ` +
            regions.map((r) => r.id).join(', '),
        );
      }
    }

    /* -- Namespace headroom ---------------------------------------------- */
    console.log(`\nNamespace headroom`);
    const namespaces = await attempt('GetNamespaces', () => listNamespaces());
    if (namespaces) {
      ok(`${namespaces.length} namespace(s) exist today`);
      warn(
        'each student creates one more. The default account limit is 10 and it does not ' +
          'auto-raise for idle namespaces — confirm your support ticket landed.',
      );
    }

    /* -- Custom role headroom (Session 3) -------------------------------- */
    console.log(`\nCustom roles (Session 3, cap 25 per account)`);
    try {
      const roles = await listCustomRoles();
      const free = CUSTOM_ROLE_CAP - roles.length;
      ok(`${roles.length} custom role(s) exist — room for ${free} more`);
      if (free < 20) {
        warn(
          `Session 3 creates one per student. ${free} free slot(s) caps your cohort at ${free}; ` +
            'beyond that, pre-create one shared role and have students assign it instead.',
        );
      }
    } catch (err) {
      bad(
        `cannot list custom roles: ${reason(err)}\n` +
          `      Custom Roles are Pre-release. If they are not enabled on this account, Session 3's ` +
          `custom-role checkpoints cannot pass — ask Temporal support to enable them.`,
      );
    }
  }

  /* -- Data plane reachability (Sessions 1, 4, 6) ------------------------ */
  console.log(`\nData-plane grading (Sessions 1, 4, 6)`);
  warn(
    'the grader authenticates with your Account Owner key, which carries Namespace ADMIN on every ' +
      'namespace — read and write. Only src/cloud/dataplane.ts restrains it to reads.',
  );
  warn(
    'Worker Deployments (Session 4) are public preview. If they are unavailable on this account, ' +
      "describeWorkerDeployment returns NOT_FOUND, which is indistinguishable from a student's " +
      'worker being unversioned — check with a real namespace before the workshop.',
  );

  /* -- Temporal ---------------------------------------------------------- */
  console.log(`\nTemporal — ${cfg.TEMPORAL_NAMESPACE} (${cfg.TEMPORAL_ADDRESS})`);
  try {
    const client = await getTemporalClient();
    // DescribeNamespace, not GetSystemInfo: the latter is unauthenticated and
    // succeeds with a completely bogus API key, which makes it useless here.
    await client.workflowService.describeNamespace({ namespace: cfg.TEMPORAL_NAMESPACE });
    ok(`connected and authorised on ${cfg.TEMPORAL_NAMESPACE}`);
  } catch (err) {
    bad(
      `cannot connect: ${reason(err)}\n` +
        `      API-key auth needs a REGIONAL address (<region>.<provider>.api.temporal.io:7233);\n` +
        `      mTLS needs the namespace address (<namespace>.<account>.tmprl.cloud:7233).`,
    );
  }

  /* -- Portal configuration ---------------------------------------------- */
  console.log(`\nInvite link`);
  ok(inviteUrl());
  ok(`rotates at ${nextRotationAt().toISOString()} (midnight ${cfg.PORTAL_LINK_TIMEZONE})`);
  warn(
    'the URL above uses PORTAL_BASE_URL, the no-request fallback. /instructor derives ' +
      'the origin from your browser instead, so copy the link from there — it will have ' +
      'the right host and port.',
  );

  console.log(`\nEmail allowlist`);
  if (cfg.PORTAL_ALLOWED_EMAIL_DOMAINS.length === 0) {
    bad('PORTAL_ALLOWED_EMAIL_DOMAINS is empty — every request will be rejected. Use * to allow any.');
  } else if (allowsAnyDomain(cfg.PORTAL_ALLOWED_EMAIL_DOMAINS)) {
    warn(
      `wildcard "*" — any address is accepted, so the rotating link and the ` +
        `${cfg.PORTAL_DAILY_SEAT_CAP}/day seat cap are your only controls on who gets Global Admin`,
    );
  } else {
    ok(`restricted to ${cfg.PORTAL_ALLOWED_EMAIL_DOMAINS.join(', ')}`);
  }

  console.log(`\nEmail denylist`);
  if (cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.length === 0) {
    skip('PORTAL_BLOCKED_EMAIL_DOMAINS is empty — nothing is blocked');
  } else {
    ok(`blocking ${cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.join(', ')}`);
    if (cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.includes('*')) {
      bad('the denylist contains "*", which blocks every address — no invitation can succeed');
    }
    // A domain on both lists is rejected: the denylist is checked first and
    // wins. Silently, if nobody says so before the workshop starts.
    const shadowed = cfg.PORTAL_ALLOWED_EMAIL_DOMAINS.filter(
      (allowed) =>
        allowed !== '*' &&
        cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.some((blocked) => domainMatches(allowed, blocked)),
    );
    if (shadowed.length > 0) {
      bad(
        `${shadowed.join(', ')} appears on the allowlist but is blocked by the denylist — ` +
          `the denylist wins, so those attendees will be rejected`,
      );
    }
  }

  console.log(`\nSweeper`);
  if (cfg.SWEEPER_MODE === 'live') {
    warn('live mode deletes resources — consider one dry-run pass against the real account first');
  } else {
    ok('dry-run: reports what it would delete, deletes nothing');
  }

  console.log(failures === 0 ? '\nPreflight passed.\n' : `\nPreflight FAILED (${failures}).\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nPreflight could not run: ${reason(err)}\n`);
  process.exit(1);
});
