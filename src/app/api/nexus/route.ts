import { NextResponse } from 'next/server';
import { readSwitchboard } from '@/cloud/nexus';
import { verifyInstructorToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Live Nexus Switchboard for the Rate Desk segment. Instructor-only, for the
 * same reason the mirror is: it reads across every student's namespace.
 *
 * The desk namespace is a query parameter rather than configuration. It is
 * chosen on the day, it can change between cohorts, and baking it into the
 * environment would mean a redeploy to point the screen somewhere else.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!verifyInstructorToken(url.searchParams.get('t'))) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const desk = (url.searchParams.get('ns') ?? '').trim();
  if (!desk) {
    return NextResponse.json({ error: 'ns (desk namespace) is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await readSwitchboard(desk));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
