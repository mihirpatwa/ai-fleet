'use client';
// Single source of truth for the header's active project. Three persistence
// tiers (in order of precedence, both read and write):
//   1. URL ?project=  — shareable links + back/forward
//   2. cookie aifleet-project — survives route changes (the menu doesn't carry
//      query params, so without the cookie the board would silently fall back
//      to projects()[0] and lose the user's running task)
//   3. zustand store — instant client mirror so the picker stays in sync
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useProject } from '@/lib/stores/useProject';

// Mirror of ACTIVE_PROJECT_COOKIE in lib/activeProject.ts — copied here so
// this client module doesn't pull in next/headers via that file.
const COOKIE = 'aifleet-project';

function writeProjectCookie(value: string): void {
  if (typeof document === 'undefined') return;
  // 1 year, lax — same site only, safe for an internal dashboard.
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function useActiveProject(): { current: string; apply: (path: string) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const storeCurrent = useProject((s) => s.current);
  const setProject = useProject((s) => s.setProject);

  const current = params.get('project') ?? storeCurrent ?? '';

  const apply = (path: string): void => {
    if (!path) return;
    setProject(path);
    writeProjectCookie(path);
    const sp = new URLSearchParams(params.toString());
    sp.set('project', path);
    router.push(`${pathname}?${sp.toString()}`);
  };

  return { current, apply };
}
