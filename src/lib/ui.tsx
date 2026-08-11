import type { ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';
import type { SnippetLang } from './highlight';

export function Wordmark() {
  return (
    <div className="wordmark">
      <span className="wordmark-dot" aria-hidden />
      <span>
        <span className="text-content-primary">Temporal</span> Cloud Training
      </span>
    </div>
  );
}

export function Shell({
  children,
  eyebrow,
  title,
  subtitle,
  aside,
}: {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:py-14">
      <div className="mb-10">
        <Wordmark />
      </div>

      <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow && <div className="label mb-2.5 text-brand-soft">{eyebrow}</div>}
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-content-primary sm:text-[32px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 max-w-2xl text-[15px] leading-7 text-content-secondary">{subtitle}</p>
          )}
        </div>
        {aside}
      </header>
      {children}
    </main>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'border-line-subtle bg-surface-table/50 text-content-secondary',
    good: 'border-success-border/40 bg-success/10 text-success',
    bad: 'border-danger-border/40 bg-danger/10 text-danger',
    warn: 'border-warning-border/40 bg-warning/10 text-warning',
    info: 'border-brand/45 bg-brand/15 text-brand-soft',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Callout({ tone, children }: { tone: 'note' | 'warn'; children: ReactNode }) {
  const cls =
    tone === 'warn'
      ? 'border-warning-border/30 bg-warning/[0.08] text-warning/95'
      : 'border-brand/35 bg-brand-dim/60 text-content-body';
  return <div className={`rounded-lg border px-4 py-3 text-[14px] leading-6 ${cls}`}>{children}</div>;
}

export function Code({ children, lang }: { children: string; lang?: SnippetLang }) {
  return <CodeBlock lang={lang}>{children}</CodeBlock>;
}

/**
 * Renders `backtick` spans as inline code and **double-asterisk** spans as bold.
 * Deliberately not a markdown parser — session copy needs exactly two things:
 * commands and file paths that stop hiding inside prose, and the one clause per
 * step that a student must not skim past.
 *
 * Bold is here because the copy was already written for it. Every session file
 * used `**…**` and got literal asterisks on the page, which is the failure mode
 * of supporting half a syntax: the author cannot tell from the source that it
 * did not work.
 */
export function RichText({ children }: { children: string }) {
  return (
    <>
      {children.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              className="rounded border border-line-subtle/40 bg-surface-primary/60 px-1.5 py-0.5 font-mono text-[0.88em] text-brand-soft"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-content-primary">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return part;
      })}
    </>
  );
}

/**
 * A link out of the portal — almost always deep into the student's own
 * namespace in the Cloud UI. Its own component because `RichText` renders no
 * anchors, so a URL in prose is unclickable text.
 */
export function ExternalLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-block text-[13px] font-medium text-brand-soft underline
                 decoration-brand-soft/40 underline-offset-2 hover:decoration-brand-soft"
    >
      {label} ↗
    </a>
  );
}

/**
 * A shell command with the outcome the student should see beneath it.
 *
 * Used by both "Use what you built" — where nothing is graded, so `grades` is
 * never passed — and the Lab, where a step that satisfies a checkpoint says so.
 * `command` and `expect` are optional because a Lab step can be a decision
 * ("write down the rollback you would run") rather than something to type.
 *
 * `snippet` is the step's own artifact — the file the step is asking for. It
 * renders above `command` so a step can hand over the configuration and then
 * the command that consumes it, in that order. `link` renders last: where to go
 * and watch what the command did.
 */
export function CommandStep({
  index,
  label,
  command,
  expect,
  grades,
  required,
  snippet,
  link,
}: {
  index: number;
  label: string;
  command?: string;
  expect?: string;
  /** Human-readable title of the checkpoint this step satisfies. */
  grades?: string;
  /** Badge text for an ungraded step that later sessions nonetheless depend on. */
  required?: string;
  snippet?: ReactNode;
  link?: { label: string; url: string };
}) {
  return (
    <li className="border-l-2 border-line-subtle/60 pl-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[14px] font-medium leading-6 text-content-primary">
        <span className="text-content-faint">{index}.</span>
        <span>{label}</span>
        {grades && (
          <span
            className="rounded border border-success-border/40 bg-success/10 px-1.5 py-0.5 text-[11px]
                       font-medium text-success"
            title={`Satisfies the exit check "${grades}"`}
          >
            graded · {grades}
          </span>
        )}
        {required && (
          <span
            className="rounded border border-warning-border/40 bg-warning/10 px-1.5 py-0.5 text-[11px]
                       font-medium text-warning"
            title="Ungraded, but the rest of the workshop depends on it"
          >
            don&apos;t skip · {required}
          </span>
        )}
      </div>
      {snippet && <div className={command ? 'mb-3' : undefined}>{snippet}</div>}
      {command && <CodeBlock>{command}</CodeBlock>}
      {expect && (
        <p className="mt-2 text-[13px] leading-6 text-content-subtle">
          <span className="font-medium text-content-secondary">Expect:</span>{' '}
          <RichText>{expect}</RichText>
        </p>
      )}
      {link && (
        <p className="mt-2">
          <ExternalLink label={link.label} url={link.url} />
        </p>
      )}
    </li>
  );
}

export function Denied({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8 flex justify-center">
        <Wordmark />
      </div>
      <div className="card p-8 text-center">
        <h1 className="text-lg font-semibold text-content-primary">Not available</h1>
        <p className="mt-2 text-sm leading-6 text-content-subtle">{reason}</p>
      </div>
    </main>
  );
}

export function relative(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return '—';
  const delta = ms - now;
  const abs = Math.abs(delta);
  const units: Array<[number, string]> = [
    [60_000, 'min'],
    [3_600_000, 'hr'],
    [86_400_000, 'day'],
  ];
  let value = Math.round(abs / 1000);
  let unit = 'sec';
  for (const [divisor, name] of units) {
    if (abs >= divisor) {
      value = Math.round(abs / divisor);
      unit = name;
    }
  }
  const plural = value === 1 ? '' : 's';
  return delta >= 0 ? `in ${value} ${unit}${plural}` : `${value} ${unit}${plural} ago`;
}
