import { timingSafeEqual } from 'node:crypto';
import { config } from '@/config';

/**
 * The invite link is one configured code, PORTAL_LINK_CODE. There is no link
 * table to store or replicate and nothing derived at runtime — every process
 * reads the same value from its environment.
 *
 * It has been through two simpler-is-better rounds worth recording, because
 * both were tried in the other direction first:
 *
 *  1. It used to be an HMAC of the calendar day, which expired every link at
 *     midnight. Cloud access lasts 48 hours, so students were locked out of the
 *     portal halfway through their own window and someone had to re-paste a new
 *     link on day two. Expiry became an action rather than a clock.
 *  2. It was then an HMAC of PORTAL_LINK_SECRET with the day dropped — but with
 *     no rotation left, hashing a secret to produce one fixed string bought
 *     nothing over configuring that string. The secret is gone; the code is the
 *     configuration.
 *
 * Retiring a link is therefore one command: set a new PORTAL_LINK_CODE. Every
 * outstanding link dies at once, and access already granted is untouched — the
 * running `invitation` workflows still revoke on their own schedule.
 *
 * It is deployed as a SECRET rather than as plain config. Six characters that get
 * projected onto a wall are not much of a secret, but they are the only thing
 * between a stranger and the invite form, and a value in git is a value that
 * outlives the workshop it was for.
 *
 * This gates who may REQUEST access. It is not, on its own, an access control —
 * the email domain allowlist and the seat cap are. See README.
 */

const DAY_FORMAT_LOCALE = 'en-CA'; // yields YYYY-MM-DD

/**
 * The calendar day the DAILY SEAT CAP is counted against, in
 * PORTAL_LINK_TIMEZONE. Only the cap uses this — the link itself is stable.
 *
 * The zone still matters for the same reason it always did: anchored to UTC the
 * boundary lands mid-workshop for an Australia/NZ audience, so a room could hit
 * the cap and then watch it reset over lunch.
 */
export function seatCapDay(at: Date = new Date(), timeZone = config().PORTAL_LINK_TIMEZONE): string {
  return new Intl.DateTimeFormat(DAY_FORMAT_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function currentToken(): string {
  return config().PORTAL_LINK_CODE;
}

export function verifyToken(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  // Case-insensitive: the link gets typed off a screen, and the token has no
  // uppercase characters to lose.
  const supplied = candidate.trim().toLowerCase();
  const expected = currentToken();
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
export function inviteUrl(base?: string): string {
  const origin = (base ?? config().PORTAL_BASE_URL).replace(/\/$/, '');
  return `${origin}/?k=${currentToken()}`;
}

/**
 * Instant the daily seat cap next resets. Found by bisection rather than offset
 * arithmetic so DST transitions in the target zone are handled by Intl rather
 * than by us.
 */
export function nextSeatResetAt(at: Date = new Date(), timeZone = config().PORTAL_LINK_TIMEZONE): Date {
  const today = seatCapDay(at, timeZone);
  let lo = at.getTime();
  let hi = lo + 3 * 24 * 60 * 60 * 1000;

  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (seatCapDay(new Date(mid), timeZone) === today) lo = mid;
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
