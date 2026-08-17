import { defineQuery, defineSignal, defineUpdate } from '@temporalio/workflow';
import {
  NAMES,
  type CanaryState,
  type ExtendWindowsRequest,
  type ExtendWindowsResult,
  type InvitationState,
  type RegistryState,
  type SeatDecision,
  type SeatRequest,
} from './shared';

/** Typed handles. Only workflow code imports this module. */

export const invitationStateQuery = defineQuery<InvitationState>(NAMES.invitationState);
/** Ends a student's access early. */
export const revokeSignal = defineSignal<[string | undefined]>(NAMES.revoke);
/** Instructor-only: extends the window for a straggler. */
export const extendSignal = defineSignal<[number]>(NAMES.extend);

export const requestSeatUpdate = defineUpdate<SeatDecision, [SeatRequest]>(NAMES.requestSeat);
/** The sweeper half of extending a student. See ExtendWindowsRequest. */
export const extendWindowsUpdate = defineUpdate<ExtendWindowsResult, [ExtendWindowsRequest]>(
  NAMES.extendWindows,
);
export const registryStateQuery = defineQuery<RegistryState>(NAMES.registryState);
/** Re-snapshots the baseline. Only safe when the account is known to be clean. */
export const recaptureBaselineSignal = defineSignal<[]>(NAMES.recaptureBaseline);
export const sweepNowSignal = defineSignal<[]>(NAMES.sweepNow);

export const canaryStateQuery = defineQuery<CanaryState>(NAMES.canaryState);
