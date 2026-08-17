/**
 * A small syntax tokeniser for the snippets shown in the Lab panes.
 *
 * Deliberately hand-rolled rather than Shiki or Prism. Those bring a WASM
 * grammar engine or a 30kB runtime to colour six snippets in two languages, and
 * every dependency here is one more thing to explain to a bank's security review
 * before the workshop. This is ~100 lines with no runtime dependency, and it
 * only has to be right about the code we actually ship.
 *
 * The one non-obvious behaviour is comments. Half the lab snippets are *entirely*
 * comment — they teach with a Terraform-shaped or Python-shaped fragment indented
 * inside `#` lines, because the real edit belongs in a file the student already
 * has. Colouring those as one flat block of comment would leave three of the six
 * labs looking like highlighting had failed. So an indented comment payload is
 * tokenised too, and only its *unclassified* text falls back to comment colour.
 * Flush-left comment lines are prose and stay prose — that is what keeps a
 * quoted English phrase from turning green.
 */

export type SnippetLang = 'hcl' | 'yaml';

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'literal'
  | 'keyword'
  | 'attr'
  | 'ref'
  | 'punct';

export interface Token {
  text: string;
  kind: TokenKind;
}

const HCL_KEYWORDS = new Set([
  'resource',
  'data',
  'variable',
  'output',
  'provider',
  'terraform',
  'module',
  'locals',
  'dynamic',
  'for_each',
  'count',
  'depends_on',
  'lifecycle',
  'required_providers',
]);

const LITERALS = new Set(['true', 'false', 'null']);

/**
 * YAML 1.1 also reads these as booleans. They stay out of the shared set
 * because "no" is an ordinary English word, and the runbook prose in Session 5
 * ("Workflow stuck, no error") is scanned as HCL.
 */
const YAML_LITERALS = new Set(['yes', 'no', 'on', 'off', '~']);

/**
 * Alternation order is the priority order: strings before anything that could
 * appear inside one, `attr` (an identifier the parser can see is a left-hand
 * side) before the bare-identifier catch-all.
 */
const HCL_SCAN = new RegExp(
  [
    /(?<string>"(?:[^"\\\n]|\\.)*")/,
    /(?<number>\b\d+(?:\.\d+)?\b)/,
    /(?<attr>[A-Za-z_][A-Za-z0-9_-]*(?=\s*=(?!=)))/,
    // A traversal: temporalcloud_namespace.lab.id
    /(?<ref>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)/,
    /(?<word>[A-Za-z_][A-Za-z0-9_-]*)/,
    /(?<punct>[{}[\](),=:])/,
  ]
    .map((r) => r.source)
    .join('|'),
  'g',
);

/**
 * `^` with the `m` flag is what keeps `testing://…` from reading as a key —
 * a YAML key is only a key at the start of its line.
 */
const YAML_SCAN = new RegExp(
  [
    /(?<attr>^[ \t]*(?:-[ \t]+)?[A-Za-z_][\w.-]*(?=[ \t]*:))/,
    /(?<string>"(?:[^"\\\n]|\\.)*"|'[^'\n]*')/,
    // 1h, 15m, 200 — durations and sizes read as one literal, not a number
    // glued to a stray letter.
    /(?<number>\b\d+(?:\.\d+)?[a-z]*\b)/,
    /(?<word>[A-Za-z_][\w-]*)/,
    /(?<punct>[{}[\](),:])/,
  ]
    .map((r) => r.source)
    .join('|'),
  'gm',
);

function classify(groups: Record<string, string | undefined>, lang: SnippetLang): TokenKind {
  if (groups.string !== undefined) return 'string';
  if (groups.number !== undefined) return 'literal';
  if (groups.attr !== undefined) return 'attr';
  if (groups.ref !== undefined) return 'ref';
  if (groups.punct !== undefined) return 'punct';

  const word = groups.word ?? '';
  if (LITERALS.has(word)) return 'literal';
  if (lang === 'yaml' && YAML_LITERALS.has(word)) return 'literal';
  if (lang === 'hcl' && HCL_KEYWORDS.has(word)) return 'keyword';
  return 'plain';
}

function scan(text: string, lang: SnippetLang): Token[] {
  const re = lang === 'hcl' ? HCL_SCAN : YAML_SCAN;
  const out: Token[] = [];
  let last = 0;

  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), kind: 'plain' });
    out.push({ text: m[0], kind: classify(m.groups ?? {}, lang) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' });
  return out;
}

/**
 * Index of the comment marker on this line, or -1. Scanning for it rather than
 * indexOf-ing matters in YAML, where `testing://…` is a value and in HCL where
 * `"https://…"` is a string — neither starts a comment.
 */
function commentStart(line: string, lang: SnippetLang): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || (lang === 'yaml' && c === "'")) quote = c;
    else if (c === '#') return i;
    else if (lang === 'hcl' && c === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

/** How far the payload after a comment marker is indented. */
const INDENTED_SAMPLE = /^[#/]+([ \t]{2,})/;

export function highlight(code: string, lang: SnippetLang): Token[] {
  const out: Token[] = [];

  code.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ text: '\n', kind: 'plain' });

    const at = commentStart(line, lang);
    if (at === -1) {
      out.push(...scan(line, lang));
      return;
    }

    if (at > 0) out.push(...scan(line.slice(0, at), lang));

    const comment = line.slice(at);
    if (!INDENTED_SAMPLE.test(comment)) {
      out.push({ text: comment, kind: 'comment' });
      return;
    }

    // An indented code sample inside a comment: keep the classified tokens,
    // demote everything else to comment so the block still reads as commentary.
    out.push(
      ...scan(comment, lang).map((t) =>
        t.kind === 'plain' || t.kind === 'punct' ? { ...t, kind: 'comment' as const } : t,
      ),
    );
  });

  return out;
}
