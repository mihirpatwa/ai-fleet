// Proxy: daemon config. GET reads the live config; PUT applies a partial
// patch (daemon re-validates + hot-reloads, reports restartNeeded).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return proxy('/config');
}

export async function PUT(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
