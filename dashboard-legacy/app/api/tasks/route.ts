// Proxy for the daemon's task API. GET forwards query params (project_root,
// status); POST forwards a goal submission. Kept thin so the daemon stays the
// single writer/source of truth.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return proxy(`/tasks${qs}`);
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
