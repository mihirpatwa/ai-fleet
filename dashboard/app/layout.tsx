import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';
import { projects } from '@/lib/db';
import { TopBar } from '@/components/top-bar';
import { Live } from '@/components/live';

export const metadata: Metadata = {
  title: 'ai-fleet dashboard',
  description: 'Live view of the autonomous agent fleet',
};

const NAV = [
  { href: '/', label: 'Board' },
  { href: '/goals', label: 'Goals' },
  { href: '/agents', label: 'Agents' },
  { href: '/security', label: 'Security' },
  { href: '/memory', label: 'Memory' },
  { href: '/cost', label: 'Cost' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* TopBar reads useSearchParams(); Suspense lets the static
            not-found page prerender without a CSR bailout. */}
        <Suspense fallback={<div className="h-[57px] border-b" aria-hidden />}>
          <TopBar projects={projects()} />
        </Suspense>
        <nav className="flex gap-1 border-b px-4 py-2 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="p-4">{children}</main>
        <Live />
      </body>
    </html>
  );
}
