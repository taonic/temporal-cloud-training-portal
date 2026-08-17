'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CallerState,
  DeskEscalation,
  SwitchboardCaller,
  SwitchboardState,
} from '@/cloud/nexus';

/**
 * The Risk Desk switchboard, for projecting during the Nexus segment.
 *
 * The SVG is drawn imperatively inside a ref rather than as JSX, and that is a
 * deliberate split: the ring animates at 60fps (spokes slide as the ring
 * re-spaces, pulses travel, stalled calls breathe) while the data behind it
 * arrives on a four-second poll. Rendering the ring through React would mean
 * either re-rendering the tree every frame or fighting it every poll. So React
 * owns the data, the input and the ledger table; this component's effect owns
 * the geometry and writes attributes straight onto the DOM.
 *
 * Nothing is seeded. A spoke exists because a namespace called.
 */

const POLL_MS = 4000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 450;
const CY = 300;
const R = 232;
const HUB_R = 62;
const TAU = Math.PI * 2;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const COLOUR: Record<CallerState, { ring: string; fill: string; wire: string; dot: string }> = {
  inflight: { ring: '#9aa0f5', fill: '#141414', wire: '#2f3570', dot: '#9aa0f5' },
  backoff: { ring: '#fec118', fill: 'rgba(254,193,24,0.14)', wire: '#4a3b12', dot: '#fec118' },
  done: { ring: '#00e175', fill: 'rgba(0,225,117,0.14)', wire: '#14452f', dot: '#00e175' },
  denied: { ring: '#ff643c', fill: 'rgba(255,100,60,0.14)', wire: '#4a2018', dot: '#ff643c' },
  failed: { ring: '#ff643c', fill: 'rgba(255,100,60,0.10)', wire: '#4a2018', dot: '#ff643c' },
};

const CHIP: Record<CallerState, { cls: string; label: string }> = {
  inflight: { cls: 'text-brand-soft border-brand-soft/40 bg-brand/15', label: 'in flight' },
  backoff: { cls: 'text-warning border-warning/45 bg-warning/10', label: 'backing off' },
  done: { cls: 'text-success border-success/40 bg-success/10', label: 'completed' },
  denied: { cls: 'text-danger border-danger/45 bg-danger/10', label: 'denied' },
  failed: { cls: 'text-danger border-danger/40 bg-danger/5', label: 'failed' },
};

/** One spoke's animation state. Lives outside React entirely. */
interface Spoke {
  namespace: string;
  state: CallerState;
  angle: number;
  targetAngle: number;
  birth: number;
  /** 0 at the node, 1 at the hub edge. */
  t: number;
  stallAt: number;
  wire: SVGLineElement;
  ring: SVGCircleElement;
  label: SVGTextElement;
  dot: SVGCircleElement;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function Switchboard({ token }: { token: string }) {
  const [desk, setDesk] = useState('');
  const [data, setData] = useState<SwitchboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Per-escalation note, keyed by the desk's workflow id. */
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Signals in flight, and ones already sent but not yet gone from the poll. */
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Record<string, 'approve' | 'decline'>>({});

  const svgRef = useRef<SVGSVGElement | null>(null);
  const spokes = useRef<Map<string, Spoke>>(new Map());
  const layers = useRef<{ wires: SVGGElement; nodes: SVGGElement; pulses: SVGGElement } | null>(null);
  const hub = useRef<{ ring: SVGCircleElement; halo: SVGCircleElement; title: SVGTextElement; sub: SVGTextElement; queue: SVGTextElement; waiting: SVGTextElement } | null>(null);

  // The desk namespace is typed in on the day; remember it across reloads so a
  // projector that goes to sleep does not cost you the setup.
  useEffect(() => {
    setDesk(window.localStorage.getItem('nexus-desk-ns') ?? '');
  }, []);
  useEffect(() => {
    if (desk) window.localStorage.setItem('nexus-desk-ns', desk);
  }, [desk]);

  /* ---- polling --------------------------------------------------- */
  const load = useCallback(async () => {
    if (!desk) return;
    try {
      const res = await fetch(
        `/api/nexus?t=${encodeURIComponent(token)}&ns=${encodeURIComponent(desk)}`,
        { cache: 'no-store' },
      );
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? `HTTP ${res.status}`);
        return;
      }
      setError(null);
      setData(payload as SwitchboardState);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [desk, token]);

  useEffect(() => {
    if (!desk) return;
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [desk, load]);

  /* ---- the one write on this page -------------------------------- */
  /**
   * Send the desk's `decide` Signal. Exactly what
   * `lab4_review.py decide <id> approve` does, from the screen already on the
   * projector — so round 3 does not need a terminal, and the room watches the
   * parked caller finish instead of watching you type.
   *
   * The row is not removed here. It disappears when the poll stops seeing an
   * answer from the `pending` Query, which is the desk telling us it un-parked
   * rather than us assuming it did.
   */
  const decide = useCallback(
    async (workflowId: string, outcome: 'approve' | 'decline') => {
      setSending((prev) => ({ ...prev, [workflowId]: true }));
      try {
        const res = await fetch(`/api/nexus?t=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ns: desk,
            workflowId,
            outcome,
            note: notes[workflowId] ?? '',
          }),
        });
        const payload = await res.json();
        if (!res.ok) {
          setError(payload.error ?? `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setSent((prev) => ({ ...prev, [workflowId]: outcome }));
        void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSending((prev) => ({ ...prev, [workflowId]: false }));
      }
    },
    [desk, load, notes, token],
  );

  /* ---- scaffolding, built once ----------------------------------- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || layers.current) return;

    const defs = svgEl('defs');
    const filter = svgEl('filter', { id: 'nx-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
    filter.appendChild(svgEl('feGaussianBlur', { stdDeviation: 5, result: 'b' }));
    const merge = svgEl('feMerge');
    merge.appendChild(svgEl('feMergeNode', { in: 'b' }));
    merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    // Guide ring, so an empty board still reads as a board.
    svg.appendChild(
      svgEl('circle', {
        cx: CX, cy: CY, r: R, fill: 'none',
        stroke: '#24303f', 'stroke-width': 1, 'stroke-dasharray': '2 9', opacity: 0.55,
      }),
    );

    const wires = svgEl('g');
    const hubG = svgEl('g');
    const nodes = svgEl('g');
    const pulses = svgEl('g');
    svg.append(wires, hubG, nodes, pulses);
    layers.current = { wires, nodes, pulses };

    const halo = svgEl('circle', { cx: CX, cy: CY, r: HUB_R, fill: 'none', stroke: '#444ce7', 'stroke-width': 1, opacity: 0.5 });
    const ring = svgEl('circle', { cx: CX, cy: CY, r: HUB_R, fill: 'rgba(68,76,231,0.14)', stroke: '#444ce7', 'stroke-width': 1.5 });
    const title = svgEl('text', { x: CX, y: CY - 6, 'text-anchor': 'middle', fill: '#f8fafc', 'font-size': 14, 'font-weight': 600, 'font-family': MONO });
    const sub = svgEl('text', { x: CX, y: CY + 13, 'text-anchor': 'middle', fill: '#8fa3c0', 'font-size': 10.5, 'font-family': MONO });
    const queue = svgEl('text', { x: CX, y: CY + 33, 'text-anchor': 'middle', fill: '#fec118', 'font-size': 11, 'font-weight': 600, 'font-family': MONO });
    hubG.append(halo, ring, title, sub, queue);

    const waiting = svgEl('text', { x: CX, y: CY + R + 52, 'text-anchor': 'middle', fill: '#667ca1', 'font-size': 12.5, 'font-family': MONO });
    waiting.textContent = 'waiting for the first call…';
    svg.appendChild(waiting);

    hub.current = { ring, halo, title, sub, queue, waiting };
  }, []);

  /* ---- sync polled data into the animation model ------------------ */
  useEffect(() => {
    const l = layers.current;
    const h = hub.current;
    if (!l || !h) return;

    h.title.textContent = (data?.deskNamespace ?? desk ?? 'risk-desk').split('.')[0] || 'risk-desk';
    h.sub.textContent = 'handler namespace';

    const callers = data?.callers ?? [];
    const seen = new Set(callers.map((c) => c.namespace));

    // Retire spokes for namespaces that no longer report a call at all.
    for (const [ns, spoke] of spokes.current) {
      if (seen.has(ns)) continue;
      spoke.wire.remove();
      spoke.ring.remove();
      spoke.label.remove();
      spoke.dot.remove();
      spokes.current.delete(ns);
    }

    callers.forEach((c) => {
      let spoke = spokes.current.get(c.namespace);
      if (!spoke) {
        const wire = svgEl('line', { 'stroke-width': 1.25, stroke: '#2f3570' });
        const ring = svgEl('circle', { r: 11, fill: '#141414', stroke: '#9aa0f5', 'stroke-width': 1.5 });
        const label = svgEl('text', { fill: '#c7d2e4', 'font-size': 11.5, 'font-family': MONO });
        const dot = svgEl('circle', { r: 4.5, fill: '#9aa0f5', filter: 'url(#nx-glow)', opacity: 0 });
        label.textContent = c.namespace.replace(/^training-/, '');
        l.wires.appendChild(wire);
        l.nodes.append(ring, label);
        l.pulses.appendChild(dot);

        const n = spokes.current.size;
        spoke = {
          namespace: c.namespace, state: c.state,
          // Born where it will sit once the ring re-spaces, so it fades in rather
          // than flying across the board.
          angle: (n / (n + 1)) * TAU - Math.PI / 2,
          targetAngle: 0, birth: 0, t: 0,
          stallAt: 0.6 + ((n * 37) % 17) / 100,
          wire, ring, label, dot,
        };
        spokes.current.set(c.namespace, spoke);
      }
      spoke.state = c.state;
    });

    // Even spacing, in arrival order — the server already sorted by start time.
    const ordered = callers
      .map((c) => spokes.current.get(c.namespace))
      .filter((s): s is Spoke => Boolean(s));
    ordered.forEach((s, i) => {
      s.targetAngle = (i / ordered.length) * TAU - Math.PI / 2;
    });

    h.waiting.setAttribute('opacity', ordered.length ? '0' : '1');
    const queued = callers.filter((c) => c.state === 'backoff').length;
    h.queue.textContent = queued ? `${queued} queued` : '';
    // The desk is only "down" as far as this screen knows if calls are piling up.
    const deskStruggling = queued > 0;
    h.ring.setAttribute('stroke', deskStruggling ? '#fec118' : '#444ce7');
    h.ring.setAttribute('fill', deskStruggling ? 'rgba(254,193,24,0.07)' : 'rgba(68,76,231,0.14)');
    h.sub.textContent = deskStruggling ? 'not answering' : 'handler namespace';
    h.sub.setAttribute('fill', deskStruggling ? '#fec118' : '#8fa3c0');
  }, [data, desk]);

  /* ---- animation ------------------------------------------------- */
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const ease = reduced ? 1 : Math.min(1, dt / 130);

      for (const s of spokes.current.values()) {
        let d = s.targetAngle - s.angle;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        s.angle += d * ease;
        s.birth = Math.min(1, s.birth + (reduced ? 1 : dt / 420));

        const ux = Math.cos(s.angle);
        const uy = Math.sin(s.angle);
        const x = CX + ux * R;
        const y = CY + uy * R;
        const c = COLOUR[s.state];

        s.wire.setAttribute('x1', String(CX + ux * (HUB_R + 4)));
        s.wire.setAttribute('y1', String(CY + uy * (HUB_R + 4)));
        s.wire.setAttribute('x2', String(x - ux * 15));
        s.wire.setAttribute('y2', String(y - uy * 15));
        s.wire.setAttribute('stroke', c.wire);
        s.wire.setAttribute('opacity', s.birth.toFixed(2));
        if (s.state === 'denied') s.wire.setAttribute('stroke-dasharray', '3 4');
        else s.wire.removeAttribute('stroke-dasharray');

        s.ring.setAttribute('cx', String(x));
        s.ring.setAttribute('cy', String(y));
        s.ring.setAttribute('r', (11 * (0.35 + 0.65 * s.birth)).toFixed(2));
        s.ring.setAttribute('stroke', c.ring);
        s.ring.setAttribute('fill', c.fill);
        s.ring.setAttribute('opacity', s.birth.toFixed(2));

        const anchor = ux > 0.12 ? 'start' : ux < -0.12 ? 'end' : 'middle';
        s.label.setAttribute('x', String(x + ux * 20));
        s.label.setAttribute('y', String(y + uy * 20 + (anchor === 'middle' ? (uy > 0 ? 12 : -6) : 4)));
        s.label.setAttribute('text-anchor', anchor);
        s.label.setAttribute('opacity', s.birth.toFixed(2));

        // A call still open gets a travelling pulse. A backing-off call stalls
        // partway and breathes: the work is somewhere, and it is not lost.
        const open = s.state === 'inflight' || s.state === 'backoff';
        if (!open) {
          s.dot.setAttribute('opacity', '0');
          s.t = 0;
        } else {
          const ceiling = s.state === 'backoff' ? s.stallAt : 1;
          s.t = Math.min(ceiling, s.t + dt / 900);
          if (s.state === 'inflight' && s.t >= 1) s.t = 0;
          const x0 = x - ux * 13;
          const y0 = y - uy * 13;
          const x1 = CX + ux * (HUB_R + 3);
          const y1 = CY + uy * (HUB_R + 3);
          s.dot.setAttribute('cx', String(x0 + (x1 - x0) * s.t));
          s.dot.setAttribute('cy', String(y0 + (y1 - y0) * s.t));
          s.dot.setAttribute('fill', c.dot);
          s.dot.setAttribute('opacity', s.birth.toFixed(2));
          s.dot.setAttribute(
            'r',
            s.state === 'backoff' ? (4.5 + Math.sin(now / 260) * 1.4).toFixed(2) : '4.5',
          );
        }
      }

      const h = hub.current;
      if (h) {
        const b = 1 + Math.sin(now / 900) * 0.035;
        h.halo.setAttribute('r', (HUB_R * b + 6).toFixed(1));
        h.halo.setAttribute('opacity', (0.3 + Math.sin(now / 900) * 0.14).toFixed(2));
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---- render ---------------------------------------------------- */
  const callers = data?.callers ?? [];
  const escalations = data?.escalations ?? [];
  const count = (s: CallerState) => callers.filter((c) => c.state === s).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-1.5">Nexus switchboard</div>
          <p className="max-w-[62ch] text-[13px] leading-6 text-content-secondary">
            The ring starts empty. Every spoke is a namespace that has called the Risk Desk —
            discovered from its own caller workflow, never from a roster.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Counter k="Callers" v={callers.length} tone="neutral" />
          <Counter k="Completed" v={count('done')} tone="good" />
          <Counter k="Backing off" v={count('backoff')} tone="warn" />
          <Counter k="Escalated" v={escalations.length} tone="warn" />
          <Counter k="Denied" v={count('denied') + count('failed')} tone="bad" />
        </div>
      </div>

      {/* Round 3's queue. Absent until an adjudicator hands one back, and absent
          again while the desk is stopped — a Query needs a Worker, and a parked
          review you cannot ask about is still parked. */}
      {desk && escalations.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle/50 px-4 py-2.5">
            <div className="label">Waiting on you</div>
            <span className="font-mono text-[12px] text-content-faint">
              {escalations.length} parked on a human · nothing is failing
            </span>
          </div>
          <div className="divide-y divide-line-table/50">
            {escalations.map((e) => (
              <Escalation
                key={e.workflowId}
                escalation={e}
                note={notes[e.workflowId] ?? ''}
                onNote={(v) => setNotes((prev) => ({ ...prev, [e.workflowId]: v }))}
                sending={Boolean(sending[e.workflowId])}
                sent={sent[e.workflowId]}
                onDecide={(outcome) => void decide(e.workflowId, outcome)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle/50 px-4 py-2.5">
            <div className="label">The wire</div>
            <label className="flex items-center gap-2">
              <span className="label">Handler namespace</span>
              <input
                className="w-[250px] rounded-md border border-line-subtle bg-surface-primary px-2.5 py-1 font-mono text-[12.5px] text-content-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                value={desk}
                spellCheck={false}
                autoComplete="off"
                placeholder="risk-desk"
                onChange={(e) => setDesk(e.target.value.trim())}
              />
            </label>
          </div>
          <svg
            ref={svgRef}
            viewBox="0 0 900 620"
            className="block h-auto w-full"
            role="img"
            aria-label="Namespaces that have called the Risk Desk, arranged around the handler namespace."
          />
          <div className="flex flex-wrap gap-4 border-t border-line-subtle/50 px-4 py-3 font-mono text-[11.5px] text-content-secondary">
            <Key colour="#9aa0f5" label="in flight" />
            <Key colour="#00e175" label="completed" />
            <Key colour="#fec118" label="backing off — queued, not lost" />
            <Key colour="#ff643c" label="denied / failed" />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle/50 px-4 py-2.5">
            <div className="label">Ledger</div>
            <span className="font-mono text-[12px] text-content-faint">
              {data ? `${callers.length} calling · ${data.silent} silent` : '—'}
            </span>
          </div>

          {!desk && (
            <p className="px-4 py-10 text-center font-mono text-[12.5px] leading-7 text-content-faint">
              Type the handler namespace above.
              <br />
              Nothing is configured in advance.
            </p>
          )}

          {desk && error && (
            <p className="px-4 py-8 text-center font-mono text-[12.5px] leading-6 text-danger">
              {error}
            </p>
          )}

          {desk && !error && callers.length === 0 && (
            <p className="px-4 py-10 text-center font-mono text-[12.5px] leading-7 text-content-faint">
              No callers yet.
              <br />
              Rows appear as namespaces reach the desk.
            </p>
          )}

          {callers.length > 0 && (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full border-collapse font-mono text-[13px]">
                <thead>
                  <tr>
                    {['#', 'Caller namespace', 'State', 'Att', 'Latency'].map((h, i) => (
                      <th
                        key={h}
                        className={`sticky top-0 z-10 border-b border-line-subtle/50 bg-surface-raised px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-content-faint ${
                          i >= 3 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {callers.map((c, i) => (
                    <Row key={c.namespace} caller={c} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {data?.warnings.map((w) => (
        <p key={w} className="font-mono text-[12px] text-warning">
          {w}
        </p>
      ))}
    </section>
  );
}

/**
 * One parked review, with the two buttons that un-park it.
 *
 * The CLI command is printed underneath rather than hidden, for two reasons: the
 * desk's own terminal prints the same line, so the room can see the button and
 * the command are one thing; and if the portal is not to hand, that line still
 * works.
 */
function Escalation({
  escalation,
  note,
  onNote,
  sending,
  sent,
  onDecide,
}: {
  escalation: DeskEscalation;
  note: string;
  onNote: (value: string) => void;
  sending: boolean;
  sent?: 'approve' | 'decline';
  onDecide: (outcome: 'approve' | 'decline') => void;
}) {
  const waited = escalation.startedAtMs
    ? Math.max(0, Math.round((Date.now() - escalation.startedAtMs) / 1000))
    : undefined;

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[13px] text-content-body">{escalation.caller}</span>
        <span className="font-mono text-[11.5px] text-content-faint">
          {waited !== undefined ? `parked ${waited}s` : 'parked'} · {escalation.workflowId}
        </span>
      </div>

      <p className="mt-1.5 max-w-[80ch] text-[13px] leading-6 text-content-secondary">
        {escalation.question}
      </p>

      {sent ? (
        <p className="mt-2.5 font-mono text-[12px] text-success">
          {sent === 'approve' ? 'Approved' : 'Declined'} — signalled. The caller&apos;s workflow
          completes on its own; this row clears on the next poll.
        </p>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            className="min-w-[240px] flex-1 rounded-md border border-line-subtle bg-surface-primary px-2.5 py-1.5 font-mono text-[12.5px] text-content-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            value={note}
            spellCheck={false}
            autoComplete="off"
            placeholder="note — lands in the caller's rationale, e.g. confirmed by phone"
            onChange={(event) => onNote(event.target.value)}
          />
          <button
            type="button"
            disabled={sending}
            onClick={() => onDecide('approve')}
            className="rounded-md border border-success/45 bg-success/10 px-3 py-1.5 font-mono text-[12.5px] font-semibold text-success transition hover:bg-success/20 disabled:opacity-40"
          >
            {sending ? 'signalling…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => onDecide('decline')}
            className="rounded-md border border-danger/45 bg-danger/10 px-3 py-1.5 font-mono text-[12.5px] font-semibold text-danger transition hover:bg-danger/20 disabled:opacity-40"
          >
            Decline
          </button>
        </div>
      )}

      <code className="mt-2 block break-all font-mono text-[11px] text-content-faint">
        uv run --group desk lab4_review.py decide {escalation.workflowId} approve
      </code>
    </div>
  );
}

function Row({ caller, rank }: { caller: SwitchboardCaller; rank: number }) {
  const chip = CHIP[caller.state];
  return (
    <tr className="border-b border-line-table/50 last:border-0">
      <td className="px-4 py-2 font-semibold tabular-nums text-brand-soft">
        {String(rank).padStart(2, '0')}
      </td>
      <td className="px-4 py-2 text-content-body">
        {caller.namespace}
        {caller.detail && (
          <span className="mt-0.5 block text-[11px] leading-4 text-content-faint">
            {caller.detail.slice(0, 90)}
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <span className={`inline-block rounded border px-2 py-[2px] text-[10.5px] font-semibold uppercase tracking-[0.07em] ${chip.cls}`}>
          {chip.label}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{caller.attempt || '—'}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        {caller.latencyMs ? `${(caller.latencyMs / 1000).toFixed(1)}s` : '—'}
      </td>
    </tr>
  );
}

function Counter({ k, v, tone }: { k: string; v: number; tone: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const colour = {
    neutral: 'text-content-secondary',
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-danger',
  }[tone];
  return (
    <div className="card min-w-[112px] px-4 py-2.5">
      <div className="label">{k}</div>
      <div className={`font-mono text-[26px] font-semibold leading-none tabular-nums ${colour}`}>
        {v}
      </div>
    </div>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour }} />
      {label}
    </span>
  );
}
