import type { Metadata } from 'next';
import { Inter, Noto_Sans_Mono } from 'next/font/google';
import './globals.css';

/**
 * Temporal's stack is Aeonik → Inter, with Noto Sans Mono for code. Aeonik is
 * licensed and not bundled here; these two are self-hosted at build time by
 * next/font, so the portal makes no third-party font request at runtime.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = Noto_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Temporal Cloud Training',
  description: 'Hands-on Temporal Cloud control plane training.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
