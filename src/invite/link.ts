import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '@/config';

/**
 * The invite link is a keyed hash of the current rotation day, so there is no
 * link table to store or replicate — any process holding PORTAL_LINK_SECRET
 * derives the same token, and rotating the secret invalidates every link at once.
 *
 * Rotation happens at midnight in PORTAL_LINK_TIMEZONE. The boundary matters:
 * anchored to UTC it would land mid-workshop for an Australia/NZ audience.
 *
 * This gates who may REQUEST access. It is not, on its own, an access control —
 * the email domain allowlist and the seat cap are. See README.
 */

const DAY_FORMAT_LOCALE = 'en-CA'; // yields YYYY-MM-DD

export function rotationDay(at: Date = new Date(), timeZone = config().PORTAL_LINK_TIMEZONE): string {
  return new Intl.DateTimeFormat(DAY_FORMAT_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Six lowercase alphanumerics: short enough to read out loud or type from a
 * projector. Base36 rather than hex, because 36^6 ≈ 2.2e9 keeps four times the
 * bits of 16^6 ≈ 1.7e7 for the same six characters.
 *
 * This is a deliberately small keyspace. It is guessable given enough requests
 * per second, so it is a convenience gate on who can *request* access, never
 * the control on who *receives* it — that is PORTAL_ALLOWED_EMAIL_DOMAINS and
 * the seat cap. See the README security section.
 */
export const TOKEN_LENGTH = 6;

export function tokenForDay(day: string): string {
  const digest = createHmac('sha256', config().PORTAL_LINK_SECRET)
    .update(`invite:${day}`)
    .digest();

  // Take 64 bits and render base36 (0-9a-z, already lowercase). Keeping the
  // low-order characters is equivalent to mod 36^6; 2^64 is ~8.5e9 times
  // larger, so the modulo bias is far below one part in a billion.
  return digest.readBigUInt64BE(0).toString(36).padStart(TOKEN_LENGTH, '0').slice(-TOKEN_LENGTH);
}

export function currentToken(at: Date = new Date()): string {
  return tokenForDay(rotationDay(at));
}

export function verifyToken(candidate: string | null | undefined, at: Date = new Date()): boolean {
  if (!candidate) return false;
  // Case-insensitive: the link gets typed off a screen, and the token has no
  // uppercase characters to lose.
  const supplied = candidate.trim().toLowerCase();
  const expected = currentToken(at);
  // Length check first: timingSafeEqual throws on mismatched lengths.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/**
 * `base` should come from the incoming request wherever one exists, so the link
 * matches whatever host and port the instructor is actually browsing — including
 * the port Next picked when 3000 was busy. PORTAL_BASE_URL is only the fallback
 * for contexts with no request, such as `pnpm ops:preflight`.
 */
export function inviteUrl(at: Date = new Date(), base?: string): string {
  const origin = (base ?? config().PORTAL_BASE_URL).replace(/\/$/, '');
  return `${origin}/?k=${currentToken(at)}`;
}

/**
 * Instant of the next rotation boundary. Found by bisection rather than
 * offset arithmetic so DST transitions in the target zone are handled by Intl
 * rather than by us.
 */
export function nextRotationAt(at: Date = new Date(), timeZone = config().PORTAL_LINK_TIMEZONE): Date {
  const today = rotationDay(at, timeZone);
  let lo = at.getTime();
  let hi = lo + 3 * 24 * 60 * 60 * 1000;

  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (rotationDay(new Date(mid), timeZone) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/* -------------------------------------------------------------------------- */
/* Email gating                                                                */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailRejection =
  | 'malformed'
  | 'domain-blocked'
  | 'domain-not-allowed'
  | 'no-domains-configured';

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Pattern grammar, shared by PORTAL_ALLOWED_EMAIL_DOMAINS and
 * PORTAL_BLOCKED_EMAIL_DOMAINS:
 *
 *   *                any domain
 *   example.com      that domain exactly
 *   *.example.com    any subdomain of it, but NOT the bare domain
 *
 * On the allowlist an empty list denies everything: allowing everyone has to be
 * spelled `*`, because "the operator left it blank" and "the operator meant to
 * let the whole internet in" should not be the same configuration. On the
 * denylist the polarity flips — empty blocks nothing, which is the normal value.
 */
export function domainMatches(domain: string, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    return domain.endsWith(suffix) && domain.length > suffix.length;
  }

  return domain === pattern;
}

/** True when the domain allowlist imposes no restriction whatsoever. */
export function allowsAnyDomain(patterns: string[] = config().PORTAL_ALLOWED_EMAIL_DOMAINS): boolean {
  return patterns.includes('*');
}

export function checkEmail(
  raw: string,
): { ok: true; email: string } | { ok: false; reason: EmailRejection } {
  const email = normalizeEmail(raw);
  if (!EMAIL_RE.test(email)) return { ok: false, reason: 'malformed' };

  const cfg = config();
  const domain = email.slice(email.lastIndexOf('@') + 1);

  // Denylist first, and it wins: an operator who blocks a domain that the
  // allowlist also matches means the block, and `*` on the allowlist is the
  // configuration the denylist exists to narrow.
  if (cfg.PORTAL_BLOCKED_EMAIL_DOMAINS.some((pattern) => domainMatches(domain, pattern))) {
    return { ok: false, reason: 'domain-blocked' };
  }

  const allowed = cfg.PORTAL_ALLOWED_EMAIL_DOMAINS;
  if (allowed.length === 0) return { ok: false, reason: 'no-domains-configured' };

  const permitted = allowed.some((pattern) => domainMatches(domain, pattern));
  return permitted ? { ok: true, email } : { ok: false, reason: 'domain-not-allowed' };
}
