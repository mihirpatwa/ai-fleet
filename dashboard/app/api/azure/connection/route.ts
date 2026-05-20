// Phase 18g proxy: Azure DevOps connection. GET — current state, POST —
// connect (org_url, project, pat), DELETE — disconnect.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/azure/connection');
}
export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/azure/connection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
export async function DELETE(): Promise<Response> {
  return proxy('/azure/connection', { method: 'DELETE' });
}
