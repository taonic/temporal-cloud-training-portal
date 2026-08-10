import { NextResponse } from 'next/server';
import { snapshotInventory } from '@/cloud/ops';
import { getCanaryState, getRegistryState } from '@/temporal/client';
import { inviteUrl, nextRotationAt } from '@/invite/link';
import { verifyInstructorToken } from '@/lib/auth';
import { requestBaseUrl } from '@/lib/request-url';

export const dynamic = 'force-dynamic';

/**
 * Live control-plane mirror. Instructor-only: it lists users and their roles,
 * which is exactly the information the student link must not expose.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!verifyInstructorToken(url.searchParams.get('t'))) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const [inventory, registry, canary] = await Promise.all([
    snapshotInventory().catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
    getRegistryState(),
    getCanaryState(),
  ]);

  return NextResponse.json({
    atMs: Date.now(),
    inventory: Array.isArray(inventory) ? inventory : [],
    inventoryError: Array.isArray(inventory) ? undefined : inventory.error,
    registry,
    canary,
    link: {
      url: inviteUrl(new Date(), await requestBaseUrl()),
      nextRotationMs: nextRotationAt().getTime(),
    },
  });
}
