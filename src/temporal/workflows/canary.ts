import * as wf from '@temporalio/workflow';
import type * as activities from '../activities';
import { canaryStateQuery } from '../handles';
import type { CanaryState } from '../shared';

const { pingCloudOps } = wf.proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  // Deliberately shallow: the point is to notice breakage fast, not to paper
  // over it with retries.
  retry: { maximumAttempts: 2, initialInterval: '5s' },
});

/**
 * A Global Admin student can delete the identity behind the portal's Cloud Ops
 * API key, and a personal API key can also simply expire. Neither can be
 * prevented, so this detects them: a cheap authenticated read on a loop, whose
 * result the instructor dashboard surfaces.
 */
export async function opsCanary(
  intervalMs: number,
  carried?: CanaryState,
): Promise<never> {
  let state: CanaryState = carried ?? { healthy: true, consecutiveFailures: 0 };
  wf.setHandler(canaryStateQuery, () => state);

  while (!wf.workflowInfo().continueAsNewSuggested) {
    const now = Date.now();
    try {
      const { identity } = await pingCloudOps();
      state = {
        healthy: true,
        lastCheckedAtMs: now,
        lastHealthyAtMs: now,
        consecutiveFailures: 0,
        identity,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state = {
        ...state,
        healthy: false,
        lastCheckedAtMs: now,
        consecutiveFailures: state.consecutiveFailures + 1,
        lastError: message,
      };
      wf.log.error('Cloud Ops canary failed — invitations and sweeps are down', {
        consecutiveFailures: state.consecutiveFailures,
        error: message,
      });
    }

    await wf.sleep(intervalMs);
  }

  await wf.continueAsNew<typeof opsCanary>(intervalMs, state);
  // continueAsNew never returns; this satisfies the `never` return type.
  throw new Error('unreachable');
}
