import { config } from '@/config';
import { allowsAnyDomain, inviteUrl, nextRotationAt, rotationDay } from '@/invite/link';
import { verifyInstructorToken } from '@/lib/auth';
import { requestBaseUrl } from '@/lib/request-url';
import { Callout, Denied, Shell } from '@/lib/ui';
import { Mirror } from './Mirror';

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
          <div className="label mb-2">Today&apos;s student link · {rotationDay()}</div>
          <code className="block break-all rounded-lg border border-line-subtle/50 bg-surface-primary/60 px-3.5 py-2.5 font-mono text-[13px] text-brand-soft">
            {inviteUrl(new Date(), base)}
          </code>
          <p className="mt-2 text-xs text-content-faint">
            Rotates at midnight {cfg.PORTAL_LINK_TIMEZONE} ({nextRotationAt().toISOString()}).
            Students re-use this same link to return to the session, so re-paste it after rotation.
          </p>
        </div>

        {allowsAnyDomain(cfg.PORTAL_ALLOWED_EMAIL_DOMAINS) ? (
          <Callout tone="warn">
            <strong className="font-semibold">Domain allowlist is wide open (<code>*</code>).</strong>{' '}
            Anyone who obtains today&apos;s link can grant themselves Global Admin on{' '}
            {cfg.TRAINING_ACCOUNT_ID} with any address. The seat cap ({cfg.PORTAL_DAILY_SEAT_CAP}
            /day) is the only remaining limit. Rotate <code>PORTAL_LINK_SECRET</code> to kill every
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
    </Shell>
  );
}
