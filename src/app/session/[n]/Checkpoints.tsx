'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GradeResult } from '@/course/types';

const ICONS = { pass: '✓', fail: '×', blocked: '·' } as const;

const STYLES = {
  pass: 'border-success-border/35 bg-success/[0.08] text-success',
  fail: 'border-danger-border/30 bg-danger/[0.06] text-danger',
  blocked: 'border-line-subtle/50 bg-surface-table/25 text-content-faint',
} as const;

export function Checkpoints({
  token,
  email,
  session,
}: {
  token: string;
  email: string;
  session: number;
}) {
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/checkpoints?s=${session}&k=${encodeURIComponent(token)}&e=${encodeURIComponent(email)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      setGrade(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [token, email, session]);

  // Poll while the lab is in progress so `terraform apply` turns checks green
  // without anyone touching the page.
  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), 15_000);
    return () => clearInterval(id);
  }, [check]);

  return (
    <section className="card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Exit check</h2>
          <p className="mt-1 text-sm text-content-subtle">
            {grade
              ? `${grade.objectivePassed}/${grade.objectiveTotal} verified` +
                (grade.total > grade.objectiveTotal
                  ? `, ${grade.passed - grade.objectivePassed}/${grade.total - grade.objectiveTotal} attested`
                  : '') +
                ' · re-checked automatically every 15s'
              : 'Checking the training account…'}
          </p>
        </div>
        <button onClick={() => void check()} className="btn-ghost" disabled={loading}>
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-warning-border/30 bg-warning/[0.08] px-3.5 py-2.5 text-sm text-warning">
          {error}
        </p>
      )}

      <ul className="space-y-2.5">
        {(grade?.results ?? []).map((r) => (
          <li key={r.id} className={`rounded-lg border px-4 py-3 ${STYLES[r.status]}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 font-mono text-sm">{ICONS[r.status]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{r.title}</span>
                  {r.selfAttested && (
                    <span className="rounded border border-warning-border/35 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                      self-attested
                    </span>
                  )}
                  {r.optional && (
                    <span className="rounded border border-line-subtle bg-surface-table/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content-subtle">
                      stretch
                    </span>
                  )}
                </div>
                {r.observed && (
                  <p className="mt-1 break-words text-[13px] leading-6 text-content-subtle">{r.observed}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {grade && (
        <p className="mt-4 text-xs leading-5 text-content-faint">
          Expected namespace <code className="text-content-secondary">{grade.expectedNamespace}</code> in{' '}
          <code className="text-content-secondary">{grade.requiredRegion}</code>. The self-attested check is
          evidence you supply — the Cloud Ops API records no provenance for how a namespace was
          created.
        </p>
      )}
    </section>
  );
}
