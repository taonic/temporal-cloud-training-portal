import Link from 'next/link';
import { config } from '@/config';
import { checkEmail, verifyToken } from '@/invite/link';
import { getInvitationState } from '@/temporal/client';
import {
  SESSIONS,
  getSession,
  labCustomRoleName,
  labGroupName,
  labNamespaceName,
  labServiceAccountName,
} from '@/course';
import { Badge, Callout, Code, CommandStep, Denied, RichText, Shell, relative } from '@/lib/ui';
import type { Reference, ReferenceGroup } from '@/course/types';
import { Checkpoints } from './Checkpoints';

export const dynamic = 'force-dynamic';

function ReferenceLink({ link }: { link: Reference }) {
  return (
    <li>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="text-[13px] font-medium text-brand-soft underline decoration-brand-soft/40 underline-offset-2 hover:decoration-brand-soft"
      >
        {link.label} ↗
      </a>
      {link.note && (
        <p className="mt-1 text-[12px] leading-5 text-content-subtle">
          <RichText>{link.note}</RichText>
        </p>
      )}
    </li>
  );
}

/**
 * One group gets its links spread across the row; several groups get a column
 * each. Laying a lone group out as a column leaves it a narrow third of the
 * width with the notes wrapping every few words.
 */
function ReferenceLinks({ groups }: { groups: ReferenceGroup[] }) {
  if (groups.length === 1) {
    const [group] = groups;
    return (
      <div>
        <div className="label mb-2.5">{group.source}</div>
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {group.links.map((link) => (
            <ReferenceLink key={link.url} link={link} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => (
        <div key={group.source}>
          <div className="label mb-2.5">{group.source}</div>
          <ul className="space-y-3">
            {group.links.map((link) => (
              <ReferenceLink key={link.url} link={link} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ n: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ n }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.k === 'string' ? query.k : '';

  if (!verifyToken(token)) {
    return (
      <Denied reason="This link is not valid, or it rotated at midnight. Ask your instructor for today's link." />
    );
  }

  const session = getSession(Number(n));
  if (!session) {
    return <Denied reason={`There is no session ${n}. Sessions ${SESSIONS.map((s) => s.number).join(', ')} are available.`} />;
  }

  const emailParam = typeof query.e === 'string' ? query.e : '';
  const check = checkEmail(emailParam);
  const email = check.ok ? check.email : undefined;

  const cfg = config();
  const invitation = email ? await getInvitationState(email) : undefined;

  const namespaceName = email ? labNamespaceName(email, cfg.LAB_NAMESPACE_PREFIX) : undefined;

  const snippetContext = email
    ? {
        namespaceName: namespaceName!,
        namespaceId: `${namespaceName}.${cfg.TRAINING_ACCOUNT_ID}`,
        accountId: cfg.TRAINING_ACCOUNT_ID,
        serviceAccountName: labServiceAccountName(email, cfg.LAB_NAMESPACE_PREFIX),
        groupName: labGroupName(email, cfg.LAB_NAMESPACE_PREFIX),
        customRoleName: labCustomRoleName(email, cfg.LAB_NAMESPACE_PREFIX),
        region: cfg.LAB_REQUIRED_REGION,
      }
    : undefined;

  const snippet = snippetContext && session.snippet ? session.snippet(snippetContext) : undefined;
  const labCommands =
    snippetContext && session.labCommands ? session.labCommands(snippetContext) : undefined;
  // The step stores a checkpoint id; students should see the checkpoint's title.
  const checkpointTitle = (id?: string) =>
    id ? session.checkpoints.find((c) => c.id === id)?.title : undefined;
  const use = snippetContext && session.use ? session.use(snippetContext) : undefined;

  /**
   * Prerequisites are the one personalised block that can render before the
   * lab does — they are what a student reads *before* they are set up, and the
   * lab body is withheld until the link carries an email. So the function form
   * falls back to placeholders rather than vanishing, which is what gating it
   * on `snippetContext` would do.
   */
  const prerequisites =
    typeof session.prerequisites === 'function'
      ? session.prerequisites(
          snippetContext ?? {
            namespaceName: '<your-namespace>',
            namespaceId: `<your-namespace>.${cfg.TRAINING_ACCOUNT_ID}`,
            accountId: cfg.TRAINING_ACCOUNT_ID,
            serviceAccountName: '<your-namespace>-worker',
            groupName: '<your-namespace>-operators',
            customRoleName: '<your-namespace>-worker-role',
            region: cfg.LAB_REQUIRED_REGION,
          },
        )
      : session.prerequisites;

  const labRefs = (session.references ?? []).filter((r) => r.placement === 'lab');
  const pageRefs = (session.references ?? []).filter((r) => r.placement !== 'lab');

  const href = (target: number) =>
    `/session/${target}?k=${encodeURIComponent(token)}${email ? `&e=${encodeURIComponent(email)}` : ''}`;

  return (
    <Shell
      eyebrow={`Session ${session.number} · Lab · ${session.labMinutes} min`}
      title={session.title}
      subtitle={session.outcome}
      aside={
        invitation ? (
          <div className="text-right">
            <Badge tone={invitation.status === 'active' ? 'good' : 'warn'}>{invitation.status}</Badge>
            <p className="mt-2 text-xs text-content-subtle">Access ends {relative(invitation.expiresAtMs)}</p>
          </div>
        ) : (
          <Badge tone="neutral">no access requested</Badge>
        )
      }
    >
      {/* Session switcher ------------------------------------------------ */}
      <nav className="mb-8 flex flex-wrap gap-2">
        {SESSIONS.map((s) => (
          <Link
            key={s.number}
            href={href(s.number)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              s.number === session.number
                ? 'border-brand/45 bg-brand/15 text-brand-soft'
                : 'border-line-subtle/50 text-content-secondary hover:border-line-secondary hover:text-white'
            }`}
          >
            {s.number}. {s.title}
          </Link>
        ))}
      </nav>

      {query.granted === 'new' && (
        <div className="mb-8">
          <Callout tone="note">
            Invitation sent. Temporal Cloud will email <strong>{email}</strong> — accept it before
            starting the lab.
          </Callout>
        </div>
      )}
      {query.granted === 'existing' && (
        <div className="mb-8">
          <Callout tone="note">
            You already have an open access window, so no second invitation was sent. Use the
            original email.
          </Callout>
        </div>
      )}

      <div className="space-y-8">
        {/* Only what this session adds. Sessions 3, 4 and 6 introduce no new
            tooling and show nothing here. */}
        {prerequisites && prerequisites.length > 0 && (
          <section className="card p-6">
            <div className="mb-1.5 flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-white">Prerequisites</h2>
              <Badge tone="warn">install first</Badge>
            </div>
            <p className="mb-5 text-[14px] leading-6 text-content-secondary">
              New for this session. Get these in before the lab starts — an install that fails
              halfway through costs you the session, not five minutes.
            </p>

            <ul className="space-y-5">
              {prerequisites.map((pre) => (
                <li key={pre.name} className="border-l-2 border-line-subtle/60 pl-4">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[14px] font-medium text-content-primary">{pre.name}</span>
                    {pre.docs && (
                      <a
                        href={pre.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-brand-soft underline decoration-brand-soft/40 underline-offset-2 hover:decoration-brand-soft"
                      >
                        docs ↗
                      </a>
                    )}
                  </div>
                  <p className="mb-2 mt-1 text-[13px] leading-6 text-content-secondary">
                    <RichText>{pre.why}</RichText>
                  </p>
                  {pre.install && <Code>{pre.install}</Code>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card p-6">
          <h2 className="mb-4 text-base font-semibold text-white">Lab — {session.labTitle}</h2>

          {!email ? (
            <Callout tone="warn">
              Request access from the invite link first — the lab is personalised to your email
              address, and the exit check needs it to know which resources are yours.
            </Callout>
          ) : (
            <>
              {session.note && (
                <div className="mb-5">
                  <Callout tone="warn">
                    <RichText>{session.note}</RichText>
                  </Callout>
                </div>
              )}

              <p className="mb-4 text-[15px] leading-7 text-content-body">
                Your namespace for these labs is{' '}
                <code className="rounded bg-surface-table/50 px-1.5 py-0.5 font-mono text-brand-soft">
                  {namespaceName}
                </code>
                . Names are unique per account and reserved after deletion, so please use exactly
                this one.
              </p>

              {/* Labs whose artifact is a sequence of actions carry their commands
                  inline, with the graded ones badged. Labs that hand over a file
                  to paste keep prose steps plus one snippet. */}
              {labCommands ? (
                <ol className="mb-5 space-y-5">
                  {labCommands.map((step, i) => (
                    <CommandStep
                      key={i}
                      index={i + 1}
                      label={step.label}
                      command={step.command}
                      expect={step.expect}
                      grades={checkpointTitle(step.grades)}
                      snippet={
                        step.snippet && snippet ? (
                          <Code lang={session.snippetLang}>{snippet}</Code>
                        ) : undefined
                      }
                      link={step.link}
                    />
                  ))}
                </ol>
              ) : (
                <ol className="mb-5 space-y-2">
                  {(session.labSteps ?? []).map((step, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-6 text-content-body">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-subtle text-[11px] text-content-subtle">
                        {i + 1}
                      </span>
                      <span>
                        <RichText>{step}</RichText>
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {/* Only when no step claimed it — otherwise it renders twice. */}
              {snippet && !labCommands?.some((step) => step.snippet) && (
                <Code lang={session.snippetLang}>{snippet}</Code>
              )}

              {labRefs.length > 0 && (
                <div className="mt-5 border-t border-line-subtle/40 pt-5">
                  <ReferenceLinks groups={labRefs} />
                </div>
              )}
            </>
          )}
        </section>

        {email && <Checkpoints token={token} email={email} session={session.number} />}

        {use && (
          <section className="card p-6">
            <div className="mb-1 flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-content-primary">Use what you built</h2>
              <Badge tone="neutral">not graded</Badge>
            </div>
            <p className="mb-5 text-[14px] leading-6 text-content-secondary">
              <RichText>{use.intro}</RichText>
            </p>

            <ol className="space-y-5">
              {use.steps.map((step, i) => (
                <CommandStep
                  key={i}
                  index={i + 1}
                  label={step.label}
                  command={step.command}
                  expect={step.expect}
                />
              ))}
            </ol>

            {use.stretch && (
              <div className="mt-6 rounded-lg border border-line-subtle/50 bg-surface-table/25 p-4">
                <h3 className="mb-1.5 text-sm font-semibold text-content-primary">
                  {use.stretch.title}
                </h3>
                <p className="text-[13px] leading-6 text-content-secondary">
                  <RichText>{use.stretch.body}</RichText>
                </p>
                {use.stretch.command && (
                  <div className="mt-3">
                    <Code>{use.stretch.command}</Code>
                  </div>
                )}
                {use.stretch.link && (
                  <a
                    href={use.stretch.link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-[13px] font-medium text-brand-soft underline
                               decoration-brand-soft/40 underline-offset-2 hover:decoration-brand-soft"
                  >
                    {use.stretch.link.label} ↗
                  </a>
                )}
              </div>
            )}
          </section>
        )}

        {/* Last on the page: what you reach for when something does not behave. */}
        {pageRefs.length > 0 && (
          <section className="card p-6">
            <h2 className="mb-1.5 text-base font-semibold text-white">Reference</h2>
            <p className="mb-5 text-[14px] leading-6 text-content-secondary">
              Worth having open in a tab. Reaching for these beats reaching for the instructor.
            </p>

            <ReferenceLinks groups={pageRefs} />
          </section>
        )}
      </div>
    </Shell>
  );
}
