import { config } from '@/config';
import { allowsAnyDomain, inviteUrl, nextSeatResetAt } from '@/invite/link';
import { verifyInstructorToken } from '@/lib/auth';
import { requestBaseUrl } from '@/lib/request-url';
import { Callout, Denied, Shell } from '@/lib/ui';
import { Mirror } from './Mirror';
import { Switchboard } from './Switchboard';

export const dynamic = 'force-dynamic';

export default async function InstructorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.t === 'string' ? params.t : '';

  if (!verifyInstructorToken(token)) {
    return <Denied reason="Instructor token required." />;
  }

  const cfg = config();
  // Derived from the request, so the link works on whatever host and port you
  // are actually browsing — including the port Next fell back to.
  const base = await requestBaseUrl();

  return (
    <Shell
      eyebrow="Instructor"
      title="Control plane mirror"
      subtitle={`Live view of ${cfg.TRAINING_ACCOUNT_ID}. Project this — it is how the room sees their own actions land.`}
    >
      <div className="mb-6 space-y-3">
        <div className="card p-5">
          <div className="label mb-2">Student link</div>
          <code className="block break-all rounded-lg border border-line-subtle/50 bg-surface-primary/60 px-3.5 py-2.5 font-mono text-[13px] text-brand-soft">
            {inviteUrl(base)}
          </code>
          <p className="mt-2 text-xs text-content-faint">
            Stable for the whole workshop — students keep using it to return to their sessions, and
            you do not re-paste it on day two. It changes only when you change{' '}
            <code>PORTAL_LINK_CODE</code>, which invalidates every outstanding link at once. The seat cap ({cfg.PORTAL_DAILY_SEAT_CAP}/day) resets at midnight{' '}
            {cfg.PORTAL_LINK_TIMEZONE} ({nextSeatResetAt().toISOString()}).
          </p>
        </div>

        {allowsAnyDomain(cfg.PORTAL_ALLOWED_EMAIL_DOMAINS) ? (
          <Callout tone="warn">
            <strong className="font-semibold">Domain allowlist is wide open (<code>*</code>).</strong>{' '}
            Anyone who obtains the link can grant themselves Global Admin on{' '}
            {cfg.TRAINING_ACCOUNT_ID} with any address
            {cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.length > 0
              ? ` except ${cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.join(', ')}`
              : ''}
            . The seat cap ({cfg.PORTAL_DAILY_SEAT_CAP}
            /day) is the only remaining limit. Change <code>PORTAL_LINK_CODE</code> to kill every
            outstanding link at once.
          </Callout>
        ) : cfg.PORTAL_ALLOWED_EMAIL_DOMAINS.length === 0 ? (
          <Callout tone="warn">
            <strong className="font-semibold">No domains configured.</strong> Every invitation
            request will be rejected. Set <code>PORTAL_ALLOWED_EMAIL_DOMAINS</code> — use{' '}
            <code>*</code> if you really do want to allow any domain.
          </Callout>
        ) : null}

        {cfg.SWEEPER_MODE === 'dry-run' && (
          <Callout tone="warn">
            The sweeper is in <strong>dry-run</strong>: it reports what it would delete and deletes
            nothing. Set <code>SWEEPER_MODE=live</code> once you have watched one pass.
          </Callout>
        )}
      </div>

      <Mirror token={token} />

      {/* The Nexus segment's screen. Inert until you type a handler namespace,
          so it costs nothing on a day you are not running that segment. */}
      <div className="mt-10 border-t border-line-subtle/50 pt-8">
        <Switchboard token={token} />
      </div>
    </Shell>
  );
}
