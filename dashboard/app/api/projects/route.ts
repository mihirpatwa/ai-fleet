// Distinct project roots from the daemon's SQLite state. New in dashboard-v2:
// the header project picker (a client component using swr) needs a list, and
// the daemon exposes no /projects endpoint and stays unchanged — so we read
// the same ~/.aifleet/state.db that lib/db.ts already opens read-only.
import { projects } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(projects());
}
