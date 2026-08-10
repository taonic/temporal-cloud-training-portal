import * as nextEnvNamespace from '@next/env';
import { z } from 'zod';

/**
 * Dual-package hazard. Next's bundler resolves @next/env with real named
 * exports, but under Node's ESM loader it is CommonJS and everything hangs off
 * `default`. Importing either way alone breaks the other — `pnpm build` and
 * `pnpm ops:preflight` each fail on the other's form — so pick whichever
 * object actually carries the function.
 */
type LoadEnvConfig = (typeof import('@next/env'))['loadEnvConfig'];

const loadEnvConfig: LoadEnvConfig | undefined = [
  nextEnvNamespace as unknown as Partial<{ loadEnvConfig: LoadEnvConfig }>,
  (nextEnvNamespace as unknown as { default?: Partial<{ loadEnvConfig: LoadEnvConfig }> }).default,
].find((candidate) => typeof candidate?.loadEnvConfig === 'function')?.loadEnvConfig;

/**
 * All configuration lives here so that the blast-radius-relevant settings
 * (which account we administer, how long access lasts, whether the sweeper
 * actually deletes) are visible in one place rather than scattered across
 * call sites.
 */

const csv = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

const schema = z.object({
  // ---- Portal ----------------------------------------------------------
  PORTAL_BASE_URL: z.string().url().default('http://localhost:3000'),
  /** HMAC key for the daily rotating invite link. Rotate this to invalidate every link immediately. */
  PORTAL_LINK_SECRET: z.string().min(16),
  /** Timezone whose midnight defines the link rotation boundary. */
  PORTAL_LINK_TIMEZONE: z.string().default('Australia/Sydney'),
  /**
   * Who may receive an invitation. Comma-separated patterns:
   *   `*` (any domain), `example.com` (exact), `*.example.com` (subdomains only).
   * Empty denies everything — allowing everyone must be spelled `*`.
   */
  PORTAL_ALLOWED_EMAIL_DOMAINS: z.string().default('').transform(csv),
  /** Maximum invitations issued per rotation day. */
  PORTAL_DAILY_SEAT_CAP: z.coerce.number().int().positive().default(25),
  /** Bearer token for the instructor-only control-plane mirror. */
  PORTAL_INSTRUCTOR_TOKEN: z.string().min(16),

  // ---- Access grant ----------------------------------------------------
  /** How long a student keeps Global Admin before the invitation workflow deletes them. */
  ACCESS_TTL_HOURS: z.coerce.number().positive().default(48),

  // ---- Temporal Cloud Ops API (the account students get access to) ------
  /** Account id students are invited into. */
  TRAINING_ACCOUNT_ID: z.string().default('bvmon'),
  CLOUD_OPS_ADDRESS: z.string().default('saas-api.tmprl.cloud:443'),
  /** Must match the api-cloud version the vendored descriptor set was built from. */
  CLOUD_OPS_API_VERSION: z.string().default('v0.19.1'),
  CLOUD_OPS_API_KEY: z.string().min(1),

  // ---- Temporal (where the portal's own workflows run) -----------------
  /**
   * API-key auth requires the REGIONAL endpoint (<region>.<provider>.api.temporal.io:7233).
   * mTLS requires the NAMESPACE endpoint (<namespace>.<account>.tmprl.cloud:7233).
   * These are not interchangeable — using the wrong one is the most common
   * "Failed to connect before the deadline" cause.
   */
  TEMPORAL_ADDRESS: z.string().default('ap-southeast-2.aws.api.temporal.io:7233'),
  TEMPORAL_NAMESPACE: z.string().default('tao.a2dd6'),
  TEMPORAL_API_KEY: z.string().optional(),
  TEMPORAL_TLS_CLIENT_CERT_PATH: z.string().optional(),
  TEMPORAL_TLS_CLIENT_KEY_PATH: z.string().optional(),
  /**
   * Base64 of the PEM contents. Platforms like Fly.io inject secrets as
   * environment variables, not files, so the *_PATH variants are unusable there.
   */
  TEMPORAL_TLS_CLIENT_CERT_DATA: z.string().optional(),
  TEMPORAL_TLS_CLIENT_KEY_DATA: z.string().optional(),
  TEMPORAL_TASK_QUEUE: z.string().default('training-portal'),

  // ---- Sweeper ---------------------------------------------------------
  /**
   * 'live' issues deletes. 'dry-run' logs what it would delete and does nothing.
   * Run dry-run once against the real account before trusting it.
   */
  SWEEPER_MODE: z.enum(['live', 'dry-run']).default('live'),
  SWEEPER_INTERVAL_MINUTES: z.coerce.number().positive().default(15),

  // ---- Session 1 lab ---------------------------------------------------
  LAB_NAMESPACE_PREFIX: z.string().default('training-'),
  /** Verify against `GetRegions` via `pnpm ops:preflight` — ids look like `aws-us-west-2`. */
  LAB_REQUIRED_REGION: z.string().default('azure-australiaeast'),
  LAB_REQUIRED_SEARCH_ATTRIBUTE: z.string().default('provisioner'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;
let envLoaded = false;

/**
 * Next.js loads .env / .env.local for the web server, but the worker and the
 * preflight script run under plain `tsx` and would otherwise see only the
 * ambient shell. Loading here — inside the single place env is ever read —
 * means every entrypoint gets the same files with the same precedence, and no
 * entrypoint can get it wrong by importing things in the wrong order.
 *
 * Real environment variables still win over .env files, so this is a no-op on
 * Fly.io and in CI.
 */
function ensureEnvLoaded(): void {
  if (envLoaded || !loadEnvConfig) return;
  envLoaded = true;
  loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== 'production',
    // Next logs "Environments: .env.local" itself; stay quiet to avoid saying it twice.
    { info: () => {}, error: console.error },
  );
}

export function config(): Config {
  if (cached) return cached;
  ensureEnvLoaded();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Read from process.env plus .env.local / .env in ${process.cwd()}. ` +
        `If that is not your project root, you are running from the wrong directory. See .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}

export const accessTtlMs = () => config().ACCESS_TTL_HOURS * 60 * 60 * 1000;
