/**
 * Fails if a customer's name has crept into the codebase.
 *
 *   pnpm check:names
 *
 * This portal is generic training tooling that gets pointed at one customer at a
 * time. Their name arrives through config — PORTAL_ALLOWED_EMAIL_DOMAINS,
 * LAB_NAMESPACE_PREFIX, .env.local — and must not end up baked into source,
 * docs, defaults or fixtures, where it would ship to the next cohort.
 *
 * It is easy to reintroduce: one example namespace in a comment, one default in
 * config.ts, one line of prose in a session. A grep run once does not prevent
 * that; this does.
 *
 * The terms themselves come from CUSTOMER_NAMES in .env.local — which is
 * gitignored, and skipped by the walker below. A guard that hard-codes the name
 * it is hunting for is the one file in the repo guaranteed to contain it, and
 * has to exempt itself to pass; naming the customer in config instead means
 * pointing this at the next one is an .env.local edit, not a commit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

interface Term {
  /** Matched case-insensitively. Use word boundaries to avoid false positives. */
  pattern: RegExp;
  why: string;
}

/** Regex-escape, so a term with a dot or dash in it cannot become a wildcard. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * CUSTOMER_NAMES from the real environment, else from .env.local, else .env —
 * the same precedence Next applies, without importing `config()`, whose schema
 * demands API keys this script has no use for.
 */
function readCustomerNames(): string | undefined {
  if (process.env.CUSTOMER_NAMES !== undefined) return process.env.CUSTOMER_NAMES;

  for (const file of ['.env.local', '.env']) {
    let content: string;
    try {
      content = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const m = /^\s*(?:export\s+)?CUSTOMER_NAMES\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      // Strip surrounding quotes, then a trailing unquoted comment.
      const value = m[1].trim();
      const quoted = /^(['"])(.*)\1/.exec(value);
      return quoted ? quoted[2] : value.split('#')[0].trim();
    }
  }
  return undefined;
}

const configured = readCustomerNames();

if (configured === undefined) {
  console.log('\nCUSTOMER_NAMES is not set, so this guard has nothing to hunt for.\n');
  console.log('Add it to .env.local — comma-separated, and the name only:\n');
  console.log('  CUSTOMER_NAMES=acme,acme-corp\n');
  console.log('Set it to empty to disable the guard deliberately. Refusing to pass silently.\n');
  process.exit(1);
}

const terms = configured
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

if (terms.length === 0) {
  console.log('\nCUSTOMER_NAMES is set but empty — name guard deliberately disabled.\n');
  process.exit(0);
}

const DENY: Term[] = terms.map((term) => ({
  // \b keeps this off base64 blobs and hashes that happen to contain the term.
  pattern: new RegExp(`\\b${escape(term)}\\b|${escape(term)}-`, 'i'),
  why: `"${term}" is a customer name — it belongs in .env.local and course.md, not in shipped code`,
}));

/**
 * Paths that may legitimately contain a customer name. Every entry is printed
 * when skipped, so an exemption is visible rather than silently swallowed.
 *
 * `labs/lab*.tf` is a pattern rather than six literal paths on purpose:
 * those files are the student's own workspace, and the whole point of the lab
 * is that they paste their real namespace into them. Listing them one at a
 * time meant the guard broke the moment someone did the next session.
 */
const ALLOW: Array<{ path: string | RegExp; why: string }> = [
  { path: 'course.md', why: 'the workshop agenda for an actual engagement — the source document, not code' },
  { path: '.env.local', why: 'local, gitignored, and the place a customer name is supposed to live' },
  {
    path: /^labs\/lab\d+\.tf$/,
    why: 'student workspace: they paste their own namespace in, and renaming an applied one destroys and recreates it',
  },
];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'obj', 'bin', '.terraform', 'dist']);
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'cloudservice.binpb', '.DS_Store']);

/**
 * Generated or local-only files. These are gitignored, so a customer name in
 * them never ships — Terraform state in particular records every resource name
 * a student applied, which is exactly what it is for.
 */
const SKIP_SUFFIXES = ['.tfstate', '.tfstate.backup', '.tfvars', '.env', '.env.local', '.tsbuildinfo'];

const root = process.cwd();

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (!SKIP_SUFFIXES.some((suffix) => entry.endsWith(suffix))) yield full;
  }
}

const allowanceFor = (rel: string) =>
  ALLOW.find((a) => (typeof a.path === 'string' ? a.path === rel : a.path.test(rel)));

const hits: Array<{ file: string; line: number; text: string; why: string }> = [];
const skipped: Array<{ rel: string; why: string }> = [];

for (const file of walk(root)) {
  const rel = relative(root, file);
  const allowance = allowanceFor(rel);
  if (allowance) {
    skipped.push({ rel, why: allowance.why });
    continue;
  }

  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable
  }
  // A NUL byte means this decoded as text but is really binary; skip it.
  if (content.indexOf(String.fromCharCode(0)) !== -1) continue;

  content.split('\n').forEach((text, i) => {
    for (const term of DENY) {
      if (term.pattern.test(text)) {
        hits.push({ file: rel, line: i + 1, text: text.trim().slice(0, 100), why: term.why });
      }
    }
  });
}

for (const s of skipped.sort((a, b) => a.rel.localeCompare(b.rel))) {
  console.log(`  – skipped ${s.rel} (${s.why})`);
}

if (hits.length === 0) {
  console.log(`\nNo customer names in shipped files. Checked ${DENY.length} term(s).\n`);
  process.exit(0);
}

console.log('');
for (const h of hits) {
  console.log(`  ✗ ${h.file}:${h.line}`);
  console.log(`      ${h.text}`);
}
console.log(`\n${hits.length} occurrence(s). ${hits[0].why}.`);
console.log('If a hit is legitimate, add the path to ALLOW in scripts/check-names.ts with a reason.\n');
process.exit(1);
