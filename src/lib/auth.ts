import { timingSafeEqual } from 'node:crypto';
import { config } from '@/config';

/**
 * The instructor view exposes the whole account inventory, including every
 * user's email address. It is deliberately gated on its own long-lived token
 * rather than the daily student link — the student link gets pasted into chat.
 */
export function verifyInstructorToken(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const expected = config().PORTAL_INSTRUCTOR_TOKEN;
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
