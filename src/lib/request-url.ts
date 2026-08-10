import { headers } from 'next/headers';
import { config } from '@/config';

/**
 * Origin of the current request, so generated links point at whatever host and
 * port the browser actually used.
 *
 * This matters in both directions: locally Next may have picked 3001 because
 * 3000 was busy, and on Fly the app sees an internal host while the browser
 * used the public hostname — the x-forwarded-* headers carry the truth.
 *
 * Falls back to PORTAL_BASE_URL only when there is no request to read.
 */
export async function requestBaseUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (host) {
      const proto =
        h.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
        (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request scope; fall through.
  }
  return config().PORTAL_BASE_URL.replace(/\/$/, '');
}
