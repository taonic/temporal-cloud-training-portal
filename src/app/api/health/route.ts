import { NextResponse } from 'next/server';
import { getCanaryState, getRegistryState } from '@/temporal/client';

export const dynamic = 'force-dynamic';

/**
 * Liveness only — this ALWAYS returns 200 when the process is serving.
 *
 * It deliberately does not fail when Temporal or the Cloud Ops API are
 * unreachable. A platform health check that goes red on a dependency outage
 * restarts the machine, and restarting cannot fix someone else's outage; it
 * just turns a degraded portal into a crash loop that also kills the worker
 * holding every pending revocation.
 *
 * The diagnostic fields are here to be read by a human (or curl), not to gate
 * the check. Real dependency health lives on /instructor.
 */
export async function GET() {
  const [registry, canary] = await Promise.all([
    getRegistryState().catch(() => undefined),
    getCanaryState().catch(() => undefined),
  ]);

  return NextResponse.json({
    ok: true,
    atMs: Date.now(),
    // Both are undefined until a worker has picked up the singletons.
    registryRunning: registry !== undefined,
    canaryHealthy: canary?.healthy ?? null,
    openWindows: registry?.windows.filter((w) => w.endMs > Date.now()).length ?? null,
  });
}
