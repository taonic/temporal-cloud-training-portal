import type { InventoryItem, ResourceKind } from '@/cloud/types';

/**
 * Pure types and names shared between workflow code, activity code and the web
 * layer. Deliberately free of runtime imports from @temporalio/* so that the
 * Next.js server can import it without dragging in the workflow runtime.
 * Signal/query/update handles live in `handles.ts`, which only workflows import.
 */

export const TASK_QUEUE_DEFAULT = 'training-portal';

/** Singleton workflow ids. */
export const REGISTRY_WORKFLOW_ID = 'training-registry';
export const CANARY_WORKFLOW_ID = 'ops-canary';

export const invitationWorkflowId = (emailHash: string) => `invite-${emailHash}`;

/** Names, used by the client side where the typed handles are not available. */
export const NAMES = {
  invitationState: 'invitationState',
  revoke: 'revoke',
  extend: 'extendMs',
  requestSeat: 'requestSeat',
  extendWindows: 'extendWindows',
  registryState: 'registryState',
  recaptureBaseline: 'recaptureBaseline',
  sweepNow: 'sweepNow',
  canaryState: 'canaryState',
} as const;

/* -------------------------------------------------------------------------- */
/* Invitation                                                                  */
/* -------------------------------------------------------------------------- */

export type InvitationStatus = 'inviting' | 'active' | 'revoked' | 'expired' | 'failed';

export interface InvitationInput {
  email: string;
  /** Wall-clock start of the access window, set by the registry when the seat was granted. */
  grantedAtMs: number;
  ttlMs: number;
}

export interface InvitationState {
  email: string;
  status: InvitationStatus;
  userId?: string;
  grantedAtMs: number;
  expiresAtMs: number;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/** A student's access window. The sweeper only touches resources born inside one. */
export interface AccessWindow {
  email: string;
  startMs: number;
  endMs: number;
}

export interface SeatRequest {
  email: string;
  /** Derived from the email by the caller; workflow code has no crypto. */
  workflowId: string;
  /** Calendar day the request arrived on, used for the per-day seat cap. */
  day: string;
  ttlMs: number;
  /** Read from server config at request time and enforced inside the update handler. */
  seatCap: number;
}

export type SeatDecision =
  | { granted: true; workflowId: string; expiresAtMs: number; alreadyHadAccess: boolean }
  | { granted: false; reason: 'seat-cap-reached' | 'start-failed'; detail?: string };

/**
 * Pushes the END of open access windows out to an absolute instant.
 *
 * This exists because extending a student is two writes, not one. The
 * `extendMs` signal moves the invitation workflow's revoke timer; it does
 * nothing to the window the SWEEPER reads. Move only the timer and the window
 * still closes on the original schedule, at which point every namespace the
 * student built dates inside a closed window — which is precisely the condition
 * `sweepOnce` deletes on. They would keep Global Admin and lose their work.
 *
 * So the window moves first and the timer second. See scripts/extend-access.ts.
 */
export interface ExtendWindowsRequest {
  /** Absolute instant the windows should now end at. Never shortens a window. */
  untilMs: number;
  /** Restrict to these addresses. Omitted means every open window. */
  emails?: string[];
}

export interface ExtendWindowsResult {
  extended: { email: string; fromMs: number; toMs: number }[];
  /** Open windows that already ran to `untilMs` or beyond, so were left alone. */
  unchanged: string[];
}

export type SweepDisposition =
  | 'deleted'
  | 'would-delete'
  | 'in-open-window'
  | 'outside-any-window'
  | 'unknown-age'
  | 'delete-failed';

export interface SweepDecision {
  kind: ResourceKind;
  id: string;
  label: string;
  createdAtMs?: number;
  disposition: SweepDisposition;
  error?: string;
}

export interface SweepReport {
  atMs: number;
  mode: 'live' | 'dry-run';
  inventorySize: number;
  decisions: SweepDecision[];
}

export interface RegistryState {
  baselineCapturedAtMs?: number;
  baselineSize: number;
  windows: AccessWindow[];
  seatsByDay: Record<string, number>;
  lastSweep?: SweepReport;
  /** Resources seen outside every access window — reported, never auto-deleted. */
  drift: SweepDecision[];
}

export interface RegistryInput {
  baseline?: InventoryItem[];
  baselineCapturedAtMs?: number;
  windows?: AccessWindow[];
  seatsByDay?: Record<string, number>;
  drift?: SweepDecision[];
}

/* -------------------------------------------------------------------------- */
/* Canary                                                                      */
/* -------------------------------------------------------------------------- */

export interface CanaryState {
  healthy: boolean;
  lastCheckedAtMs?: number;
  lastHealthyAtMs?: number;
  consecutiveFailures: number;
  lastError?: string;
  identity?: string;
}
