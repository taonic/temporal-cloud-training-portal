import type { SessionDef } from './types';
import { session1 } from './sessions/session1';
import { session2 } from './sessions/session2';
import { session3 } from './sessions/session3';
import { session4 } from './sessions/session4';
import { session5 } from './sessions/session5';

/** Add a session by writing its file and appending it here. */
export const SESSIONS: SessionDef[] = [
  session1,
  session2,
  session3,
  session4,
  session5,
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
