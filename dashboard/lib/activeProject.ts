// Server-side helper: pick the active project for an SSR page. URL ?project=
// wins (shareable links), then the `aifleet-project` cookie (persisted by the
// client `useActiveProject.apply()`), then the alphabetical first project as
// last-resort default. Keeps the project sticky across route changes so the
// board doesn't silently swap to a different project's tasks.
//
// SERVER-ONLY: pulls in next/headers. The client mirror lives in
// lib/useActiveProject.ts (copies the cookie name to avoid the import).
import 'server-only';
import { cookies } from 'next/headers';

export const ACTIVE_PROJECT_COOKIE = 'aifleet-project';

export async function getActiveProject(
  urlParam: string | undefined,
  fallback: string | undefined,
): Promise<string | undefined> {
  if (urlParam) return urlParam;
  const c = await cookies();
  const v = c.get(ACTIVE_PROJECT_COOKIE)?.value;
  return v && v.length > 0 ? v : fallback;
}
