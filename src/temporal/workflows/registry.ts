import * as wf from '@temporalio/workflow';
import type * as activities from '../activities';
import {
  recaptureBaselineSignal,
  registryStateQuery,
  requestSeatUpdate,
  sweepNowSignal,
} from '../handles';
import type {
  AccessWindow,
  RegistryInput,
  RegistryState,
  SeatDecision,
  SweepDecision,
  SweepReport,
} from '../shared';
import type { InventoryItem } from '@/cloud/types';

const { captureBaseline, sweepOnce, startInvitationWorkflow } = wf.proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    maximumInterval: '2 minutes',
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['CloudOpsAuthFailure'],
  },
});

/**
 * Access windows are kept for a while after they close so that a sweeper pass
 * still has something to match late-created resources against. Once a window is
 * pruned, anything born inside it becomes undeletable drift rather than a
 * deletion — erring towards leaving things alone.
 */
const WINDOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SEAT_DAY_RETENTION = 14;
const MAX_DRIFT_REPORTED = 200;
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function pruneSeatDays(seats: Record<string, number>): Record<string, number> {
  const days = Object.keys(seats).sort();
  const keep = days.slice(-SEAT_DAY_RETENTION);
  return Object.fromEntries(keep.map((d) => [d, seats[d]]));
}

/**
 * The long-lived singleton that owns three things the portal cannot keep
 * anywhere else:
 *
 *  - the seat cap, enforced in an Update handler so two simultaneous requests
 *    cannot both take the last seat;
 *  - the baseline inventory of the training account;
 *  - the ledger of access windows, which is what makes the sweeper's diff
 *    time-bounded rather than "anything not in the snapshot".
 *
 * It runs in a different Temporal Cloud account from the one it administers, so
 * a student holding Global Admin on the training account cannot delete it.
 */
export async function trainingRegistry(input: RegistryInput & { sweepIntervalMs?: number } = {}): Promise<void> {
  const sweepIntervalMs = input.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  let baseline: InventoryItem[] | undefined = input.baseline;
  let baselineCapturedAtMs = input.baselineCapturedAtMs;
  let windows: AccessWindow[] = input.windows ?? [];
  let seatsByDay: Record<string, number> = { ...(input.seatsByDay ?? {}) };
  let drift: SweepDecision[] = input.drift ?? [];
  let lastSweep: SweepReport | undefined;

  let sweepRequested = false;
  let recaptureRequested = false;

  wf.setHandler(registryStateQuery, (): RegistryState => ({
    baselineCapturedAtMs,
    baselineSize: baseline?.length ?? 0,
    windows,
    seatsByDay,
    lastSweep,
    drift,
  }));

  wf.setHandler(sweepNowSignal, () => {
    sweepRequested = true;
  });

  wf.setHandler(recaptureBaselineSignal, () => {
    recaptureRequested = true;
  });

  wf.setHandler(
    requestSeatUpdate,
    async (req): Promise<SeatDecision> => {
      const now = Date.now();

      // Idempotent by design: a second submission of the same address returns
      // the existing window rather than issuing a second invitation.
      const open = windows.find((w) => w.email === req.email && w.endMs > now);
      if (open) {
        return {
          granted: true,
          workflowId: req.workflowId,
          expiresAtMs: open.endMs,
          alreadyHadAccess: true,
        };
      }

      const used = seatsByDay[req.day] ?? 0;
      if (used >= req.seatCap) {
        return { granted: false, reason: 'seat-cap-reached' };
      }

      // Reserve first so concurrent updates cannot both pass the cap check.
      const window: AccessWindow = { email: req.email, startMs: now, endMs: now + req.ttlMs };
      seatsByDay = { ...seatsByDay, [req.day]: used + 1 };
      windows = [...windows, window];

      try {
        await startInvitationWorkflow({
          workflowId: req.workflowId,
          email: req.email,
          grantedAtMs: now,
          ttlMs: req.ttlMs,
        });
      } catch (err) {
        seatsByDay = { ...seatsByDay, [req.day]: used };
        windows = windows.filter((w) => w !== window);
        return {
          granted: false,
          reason: 'start-failed',
          detail: err instanceof Error ? err.message : String(err),
        };
      }

      return {
        granted: true,
        workflowId: req.workflowId,
        expiresAtMs: window.endMs,
        alreadyHadAccess: false,
      };
    },
    {
      validator: (req) => {
        if (!req?.email || !req.workflowId) throw new Error('email and workflowId are required');
        if (req.ttlMs <= 0) throw new Error('ttlMs must be positive');
        if (req.seatCap <= 0) throw new Error('seatCap must be positive');
      },
    },
  );

  if (!baseline) {
    baseline = await captureBaseline();
    baselineCapturedAtMs = Date.now();
  }

  while (!wf.workflowInfo().continueAsNewSuggested) {
    await wf.condition(() => sweepRequested || recaptureRequested, sweepIntervalMs);

    if (recaptureRequested) {
      recaptureRequested = false;
      baseline = await captureBaseline();
      baselineCapturedAtMs = Date.now();
    }
    sweepRequested = false;

    const now = Date.now();
    const report = await sweepOnce({ baseline, windows, nowMs: now });

    lastSweep = report;
    drift = report.decisions
      .filter((d) => d.disposition === 'outside-any-window')
      .slice(0, MAX_DRIFT_REPORTED);

    windows = windows.filter((w) => w.endMs > now - WINDOW_RETENTION_MS);
    seatsByDay = pruneSeatDays(seatsByDay);
  }

  // Do not continue-as-new while a seat request is mid-flight.
  await wf.condition(() => wf.allHandlersFinished());

  await wf.continueAsNew<typeof trainingRegistry>({
    baseline,
    baselineCapturedAtMs,
    windows,
    seatsByDay,
    drift,
    sweepIntervalMs,
  });
}
