import { NextResponse } from 'next/server';
import { checkEmail, verifyToken } from '@/invite/link';
import { gradeSession } from '@/course/grading';
import { SESSION_NUMBERS } from '@/course';

export const dynamic = 'force-dynamic';

/**
 * Grading is a lab aid, not a security boundary — but it does read the training
 * account, so it stays behind the same daily link as the rest of the portal.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (!verifyToken(url.searchParams.get('k'))) {
    return NextResponse.json({ error: 'link-expired' }, { status: 401 });
  }

  const check = checkEmail(url.searchParams.get('e') ?? '');
  if (!check.ok) {
    return NextResponse.json({ error: 'bad-email' }, { status: 400 });
  }

  const session = Number(url.searchParams.get('s') ?? '1');
  if (!SESSION_NUMBERS.includes(session)) {
    return NextResponse.json({ error: 'unknown-session' }, { status: 404 });
  }

  try {
    return NextResponse.json(await gradeSession(session, check.email));
  } catch (err) {
    return NextResponse.json(
      { error: 'grading-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
