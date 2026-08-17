'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InventoryItem, ResourceKind } from '@/cloud/types';
import type { CanaryState, RegistryState } from '@/temporal/shared';
import { Badge, relative } from '@/lib/ui';

interface MirrorPayload {
  atMs: number;
  inventory: InventoryItem[];
  inventoryError?: string;
  registry?: RegistryState;
  canary?: CanaryState;
  link: { url: string; nextSeatResetMs: number };
}

const KIND_LABEL: Record<ResourceKind, string> = {
  namespace: 'Namespaces',
  user: 'Users',
  serviceAccount: 'Service accounts',
  apiKey: 'API keys',
  userGroup: 'Groups',
  customRole: 'Custom roles',
  nexusEndpoint: 'Nexus endpoints',
};

const KIND_ORDER: ResourceKind[] = [
  'user',
  'namespace',
  'serviceAccount',
  'apiKey',
  'userGroup',
  'customRole',
  'nexusEndpoint',
];

export function Mirror({ token }: { token: string }) {
  const [data, setData] = useState<MirrorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/mirror?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const payload: MirrorPayload = await res.json();
      setError(null);

      // Highlight anything that appeared since the last poll — this is the bit
      // that makes the room's actions visible on the projector.
      setSeen((previous) => {
        const now = new Set(payload.inventory.map((i) => `${i.kind}:${i.id}`));
        if (previous.size > 0) {
          const added = [...now].filter((k) => !previous.has(k));
          if (added.length) {
            setFresh((f) => new Set([...f, ...added]));
            setTimeout(() => {
              setFresh((f) => {
                const next = new Set(f);
                added.forEach((k) => next.delete(k));
                return next;
              });
            }, 20_000);
          }
        }
        return now;
      });

      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => clearInterval(id);
  }, [load]);

  if (error && !data) {
    return <p className="card p-6 text-sm text-danger">Mirror unavailable: {error}</p>;
  }
  if (!data) {
    return <p className="card p-6 text-sm text-content-subtle">Loading…</p>;
  }

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: data.inventory.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);

  const sweep = data.registry?.lastSweep;

  return (
    <div className="space-y-6">
      {/* Health ---------------------------------------------------------- */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-white">Health</h2>
          {data.canary ? (
            <Badge tone={data.canary.healthy ? 'good' : 'bad'}>
              {data.canary.healthy
                ? `Ops API reachable as ${data.canary.identity ?? 'unknown'}`
                : `Ops API failing (${data.canary.consecutiveFailures}×)`}
            </Badge>
          ) : (
            <Badge tone="warn">canary not running</Badge>
          )}
          {sweep && (
            <Badge tone={sweep.mode === 'live' ? 'info' : 'warn'}>sweeper: {sweep.mode}</Badge>
          )}
        </div>

        {data.canary && !data.canary.healthy && (
          <p className="mb-3 rounded-lg border border-danger-border/30 bg-danger/[0.08] px-3.5 py-2.5 text-sm text-danger">
            {data.canary.lastError}
          </p>
        )}

        {/* Kept when the sweep report went: this is not a report of what the
            sweeper did, it is a list of things nobody will clean up for you. */}
        {(data.registry?.drift.length ?? 0) > 0 && (
          <p className="mb-3 rounded-lg border border-warning-border/30 bg-warning/[0.08] px-3.5 py-2.5 text-sm text-warning">
            {data.registry!.drift.length} resource(s) exist outside every access window. The sweeper
            will not touch these — clean them up by hand if they are workshop debris.
          </p>
        )}

        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="label mb-1">Baseline</dt>
            <dd className="text-content-body">
              {data.registry
                ? `${data.registry.baselineSize} resources, captured ${relative(
                    data.registry.baselineCapturedAtMs,
                    data.atMs,
                  )}`
                : 'registry not running'}
            </dd>
          </div>
          <div>
            <dt className="label mb-1">Open access windows</dt>
            <dd className="text-content-body">
              {data.registry?.windows.filter((w) => w.endMs > data.atMs).length ?? 0}
            </dd>
          </div>
          <div>
            <dt className="label mb-1">Seat cap resets</dt>
            <dd className="text-content-body">{relative(data.link.nextSeatResetMs, data.atMs)}</dd>
          </div>
        </dl>
      </section>

      {/* Live inventory --------------------------------------------------- */}
      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Control plane</h2>
          <span className="text-xs text-content-faint">{data.inventory.length} resources · 5s refresh</span>
        </div>

        {data.inventoryError && (
          <p className="mb-3 text-sm text-danger">{data.inventoryError}</p>
        )}

        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.kind}>
              <div className="label mb-2">
                {KIND_LABEL[group.kind]} · {group.items.length}
              </div>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const key = `${item.kind}:${item.id}`;
                  const isNew = fresh.has(key);
                  return (
                    <li
                      key={key}
                      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                        isNew
                          ? 'border-success-border/45 bg-success/12 text-success'
                          : 'border-line-subtle/40 bg-surface-table/25 text-content-body'
                      }`}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      <span className="shrink-0 text-xs text-content-faint">
                        {isNew ? 'just now' : relative(item.createdAtMs, data.atMs)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
