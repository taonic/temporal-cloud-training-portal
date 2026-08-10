import * as wf from '@temporalio/workflow';
import type * as activities from '../activities';
import { extendSignal, invitationStateQuery, revokeSignal } from '../handles';
import type { InvitationInput, InvitationState } from '../shared';

const { inviteGlobalAdmin, revokeUser } = wf.proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '2s',
    maximumInterval: '1 minute',
    maximumAttempts: 10,
    // A dead credential is not worth retrying for two days.
    nonRetryableErrorTypes: ['CloudOpsAuthFailure'],
  },
});

/**
 * One workflow per student. Owns the whole lifetime of their Global Admin
 * access: invite, hold for the TTL, revoke.
 *
 * The revoke is the entire point of running this in Temporal — the timer
 * survives portal restarts, deploys and the laptop closing, and it runs from
 * an account the student cannot reach.
 */
export async function invitation(input: InvitationInput): Promise<InvitationState> {
  let state: InvitationState = {
    email: input.email,
    status: 'inviting',
    grantedAtMs: input.grantedAtMs,
    expiresAtMs: input.grantedAtMs + input.ttlMs,
  };

  let revoked = false;
  let revokeReason: string | undefined;
  let stateChanged = false;

  wf.setHandler(invitationStateQuery, () => state);

  wf.setHandler(revokeSignal, (reason) => {
    revoked = true;
    revokeReason = reason;
    stateChanged = true;
  });

  wf.setHandler(extendSignal, (extraMs) => {
    state = { ...state, expiresAtMs: state.expiresAtMs + extraMs };
    stateChanged = true;
  });

  try {
    const { userId } = await inviteGlobalAdmin({
      email: input.email,
      asyncOperationId: `invite-${wf.workflowInfo().runId}`,
    });
    state = { ...state, userId, status: 'active' };
  } catch (err) {
    state = {
      ...state,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
    return state;
  }

  // Hold until revoked or expired. Re-derived each pass because `extendMs` can
  // move the deadline while we are waiting on it.
  for (;;) {
    if (revoked) break;
    const remainingMs = state.expiresAtMs - Date.now();
    if (remainingMs <= 0) break;

    stateChanged = false;
    await wf.condition(() => revoked || stateChanged, remainingMs);
  }

  await revokeUser({
    userId: state.userId!,
    email: state.email,
    asyncOperationId: `revoke-${wf.workflowInfo().runId}`,
  });

  state = {
    ...state,
    status: revoked ? 'revoked' : 'expired',
    error: revokeReason,
  };

  return state;
}
