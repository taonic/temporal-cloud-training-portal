import { NextResponse } from 'next/server';
import { decideEscalation, readSwitchboard } from '@/cloud/nexus';
import { verifyInstructorToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Live Nexus Switchboard for the Risk Desk segment. Instructor-only, for the
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

/**
 * Clear one escalation — the button equivalent of
 * `uv run --group desk lab4_review.py decide <workflow-id> approve`.
 *
 * The only write the portal makes into a Temporal namespace, and it is here
 * rather than in a general "signal a workflow" endpoint on purpose: the desk
 * namespace, the workflow id and the outcome are all that this accepts, and the
 * signal name is fixed in `signalHumanDecision`. `outcome` is checked against a
 * literal pair before it is passed on, because the desk decides on the string's
 * first letter and a typo would approve a payment quietly.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!verifyInstructorToken(url.searchParams.get('t'))) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const desk = String(body.ns ?? '').trim();
  const workflowId = String(body.workflowId ?? '').trim();
  const outcome = String(body.outcome ?? '').trim();
  const note = String(body.note ?? '').trim();
  const by = String(body.by ?? '').trim() || 'instructor';

  if (!desk || !workflowId) {
    return NextResponse.json({ error: 'ns and workflowId are required' }, { status: 400 });
  }
  if (outcome !== 'approve' && outcome !== 'decline') {
    return NextResponse.json({ error: 'outcome must be approve or decline' }, { status: 400 });
  }

  try {
    await decideEscalation(desk, workflowId, outcome, note, by);
    return NextResponse.json({ ok: true, workflowId, outcome });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
