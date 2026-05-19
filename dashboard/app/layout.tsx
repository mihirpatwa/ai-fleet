import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeScript } from '@/components/Shell/ThemeScript';
import { Providers } from './providers';
import { AppShell } from '@/components/Shell/AppShell';

// Spec token fontFamily is Inter; self-host it via next/font and expose it as
// --font-inter (referenced by the antd token + globals.css body).
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'ai-fleet dashboard',
  description: 'Live view of the autonomous agent fleet',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the ThemeScript mutates <html> before React
    // hydrates (dataset.theme / colorScheme / background), which is expected.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeScript />
        <Providers>
          {/* AppShell reads useSearchParams(); Suspense keeps static
              prerender from bailing the whole tree to CSR. */}
          <Suspense fallback={<div style={{ minHeight: '100vh' }} aria-hidden />}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
