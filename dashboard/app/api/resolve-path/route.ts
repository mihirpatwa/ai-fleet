// Proxy: server-side directory resolver (phase 14). Body carries either a
// typed path or a {hint_name, hint_entries} fingerprint.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/resolve-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
