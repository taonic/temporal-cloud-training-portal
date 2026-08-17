import type { SessionDef } from './types';
import { session1 } from './sessions/session1';
import { session2 } from './sessions/session2';
// Sessions 3 (Worker Versioning) and 4 (Encryption Proxy) are PARKED, not deleted.
// Their files, lab headers and sandbox assets are all still here; re-running them
// is a matter of restoring these two imports and the two SESSIONS entries below.
//
// The surviving sessions were edited when they were parked, and that edit is the
// part to remember if you put them back: every later worker was running
// `--version 2.0`, which only works BECAUSE Session 3 sets that as the
// deployment's current version. With Session 3 gone, a versioned worker registers
// a version nothing routes to and is handed no tasks at all — so Sessions 5 to 7
// now run unversioned workers and say so.
// import { session3 } from './sessions/session3';
// import { session4 } from './sessions/session4';
import { session5 } from './sessions/session5';
import { session6 } from './sessions/session6';
import { session7 } from './sessions/session7';

/** Add a session by writing its file and appending it here. */
export const SESSIONS: SessionDef[] = [
  session1,
  session2,
  // session3,  parked — see the note above the imports
  // session4,  parked
  session5,
  session6,
  session7,
];

/**
 * A Lab step that claims to satisfy a checkpoint must name one that exists.
 *
 * The badge is a promise to the student: "do this and that exit check goes
 * green". A typo'd or renamed id would render no badge at all and quietly put
 * us back where we started — a graded action with nothing pointing at it. This
 * runs at import, so it fails the build rather than the workshop.
 */
for (const session of SESSIONS) {
  if (!session.labCommands && !session.labSteps) {
    throw new Error(`Session ${session.number} has neither labSteps nor labCommands`);
  }
  const ids = new Set(session.checkpoints.map((c) => c.id));
  // A throwaway context: only the shape matters, none of the values are used.
  const probe = {
    namespaceName: 'probe',
    namespaceId: 'probe.account',
    accountId: 'account',
    serviceAccountName: 'probe',
    metricsAccountName: 'probe',
    groupName: 'probe',
    customRoleName: 'probe',
    region: 'probe',
  };
  for (const step of session.labCommands?.(probe) ?? []) {
    if (step.grades && !ids.has(step.grades)) {
      throw new Error(
        `Session ${session.number} step "${step.label}" grades unknown checkpoint "${step.grades}". ` +
          `Known: ${[...ids].join(', ')}`,
      );
    }
  }
}

export function getSession(n: number): SessionDef | undefined {
  return SESSIONS.find((s) => s.number === n);
}

export const SESSION_NUMBERS = SESSIONS.map((s) => s.number);

export * from './types';
export * from './naming';
