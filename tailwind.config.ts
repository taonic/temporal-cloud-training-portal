import type { Config } from 'tailwindcss';

/**
 * Palette lifted from temporal.io's own design tokens (the `--color-*` custom
 * properties on their stylesheet), so the portal reads as part of the same
 * family rather than an approximation of it.
 *
 * Values marked DERIVED are not theirs: their text-secondary/subtle are tuned
 * for light surfaces and are unreadable on #141414, so the mid greys here are
 * interpolated for a dark background. Everything else is verbatim.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Aeonik is Temporal's licensed brand face; it is named first so it is
        // used where installed and falls through to Inter everywhere else —
        // the same stack temporal.io ships. No font file is bundled for it.
        sans: ['Aeonik', 'var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: '#444ce7', // --color-surface-brand / --color-text-brand
          soft: '#9aa0f5', //   DERIVED: brand tint legible as text on dark
          dim: '#1a1c4c', //    --color-surface-information
        },
        action: {
          DEFAULT: '#3f43db', // --color-interactive-surface
          hover: '#3538cf', //  --color-interactive-hover
          active: '#1c0db2', // --color-interactive-active
          ghost: '#465a78', //  --color-interactive-ghost-hover
          ghostActive: '#243349', // --color-interactive-ghost-active
        },
        surface: {
          primary: '#000000', //   --color-surface-primary
          background: '#141414', // --color-surface-background
          raised: '#1b1b1b', //     DERIVED: card fill above the page
          subtle: '#374761', //     --color-surface-subtle
          table: '#243349', //      --color-surface-table
          inverse: '#f8fafc', //    --color-surface-inverse
        },
        line: {
          primary: '#7c8fb1', //   --color-border-primary
          secondary: '#465a78', // --color-border-secondary
          subtle: '#374761', //    --color-border-subtle
          table: '#243349', //     --color-border-table
        },
        content: {
          primary: '#f8fafc', //   --color-text-primary
          body: '#c7d2e4', //      DERIVED
          secondary: '#8fa3c0', // DERIVED
          subtle: '#667ca1', //    --color-interactive-secondary-surface
          faint: '#465a78', //     --color-text-secondary
        },
        success: {
          DEFAULT: '#00e175', // --color-text-success
          border: '#00cc6a', //  --color-border-success
          surface: '#008f53', // --color-surface-success
        },
        danger: {
          DEFAULT: '#ff643c', // --color-text-danger
          border: '#ff643c', //  --color-border-danger
          surface: '#c71d00', // --color-surface-danger
        },
        warning: {
          DEFAULT: '#fec118', // --color-text-warning
          border: '#feb412', //  --color-border-warning
          surface: '#fd710a', // --color-surface-warning
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
