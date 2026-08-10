'use client';

import { useMemo, useState } from 'react';
import { highlight, type SnippetLang } from './highlight';

/**
 * A code pane with a copy button in its top-right corner.
 *
 * Students copy the Terraform snippet, the proxy config and half a dozen
 * commands over a workshop day; selecting multi-line blocks by hand is where
 * transcription errors come from — a truncated namespace name fails a checkpoint
 * in a way that looks like the lab is broken.
 *
 * `lang` opts a block into syntax colour. Command panes deliberately do not use
 * it: a shell line is one thing to type, and colouring it invents a structure
 * that isn't there. The lab snippets are the blocks a student has to *read*.
 */
export function CodeBlock({ children, lang }: { children: string; lang?: SnippetLang }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const tokens = useMemo(() => (lang ? highlight(children, lang) : null), [children, lang]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(children);
      } else {
        // navigator.clipboard needs a secure context. Served over plain http on
        // a LAN address it is simply absent, so fall back rather than throw.
        const area = document.createElement('textarea');
        area.value = children;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  }

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy to clipboard"
        className={`absolute right-2 top-2 z-10 rounded-md border px-2.5 py-1 text-[11px] font-medium
          transition ${
            state === 'copied'
              ? 'border-success-border/45 bg-success/12 text-success'
              : state === 'failed'
                ? 'border-warning-border/40 bg-warning/10 text-warning'
                : 'border-line-subtle/60 bg-surface-table/70 text-content-secondary hover:border-line-secondary hover:text-content-primary'
          }`}
      >
        {label}
      </button>
      {/* pr-20 keeps long lines from running underneath the button. */}
      <pre className="overflow-x-auto rounded-xl border border-line-subtle/50 bg-surface-primary/60 p-4 pr-20 font-mono text-[12.5px] leading-6 text-content-body">
        {/* The copy button reads `children`, not the DOM, so splitting the text
            into spans cannot change what gets copied. */}
        <code className={lang ? 'code-hl' : undefined}>
          {tokens
            ? tokens.map((t, i) =>
                t.kind === 'plain' ? (
                  t.text
                ) : (
                  <span key={i} className={`tok-${t.kind}`}>
                    {t.text}
                  </span>
                ),
              )
            : children}
        </code>
      </pre>
    </div>
  );
}
