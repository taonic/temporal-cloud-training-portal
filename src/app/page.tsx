import { config } from '@/config';
import { allowsAnyDomain, verifyToken } from '@/invite/link';
import { Badge, Callout, Denied, Shell } from '@/lib/ui';
import { InviteForm } from './InviteForm';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.k === 'string' ? params.k : '';

  if (!verifyToken(token)) {
    return (
      <Denied reason="This link is not valid, or it rotated at midnight. Ask your instructor for today's link." />
    );
  }

  const cfg = config();
  const hours = cfg.ACCESS_TTL_HOURS;

  return (
    <Shell
      eyebrow="Temporal Cloud workshop"
      title="Get your training account access"
      subtitle={`Enter your work email and Temporal Cloud will send you an invitation to the ${cfg.TRAINING_ACCOUNT_ID} account as a Global Admin. Access is removed automatically after ${hours} hours.`}
      aside={<Badge tone="info">{`${hours}h access`}</Badge>}
    >
      <InviteForm
        token={token}
        allowedDomains={cfg.PORTAL_ALLOWED_EMAIL_DOMAINS}
        blockedDomains={cfg.PORTAL_BLOCKED_EMAIL_DOMAINS}
      />

      <div className="mt-6 space-y-3">
        <Callout tone="warn">
          <strong className="font-semibold">Global Admin is real admin.</strong> You will be able to
          create and delete namespaces, service accounts, API keys and other users in a shared
          account. Everything you create is deleted automatically once your {hours}-hour window
          closes. Please don&apos;t delete anyone else&apos;s work in the meantime.
        </Callout>
        <Callout tone="note">
          This portal does not send email. The invitation comes from Temporal Cloud itself, so the
          address you enter must be one you can actually receive mail at.
        </Callout>
        {allowsAnyDomain(cfg.PORTAL_ALLOWED_EMAIL_DOMAINS) && (
          <Callout tone="warn">
            <strong className="font-semibold">Any email domain is accepted.</strong> The only thing
            standing between this form and Global Admin on {cfg.TRAINING_ACCOUNT_ID} is the link
            you used to get here, and today&apos;s seat cap of {cfg.PORTAL_DAILY_SEAT_CAP}. Treat
            the link accordingly.
          </Callout>
        )}
      </div>
    </Shell>
  );
}
