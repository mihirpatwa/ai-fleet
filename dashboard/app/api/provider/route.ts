// Phase 18 proxy: current provider state (GET), connect (POST), disconnect
// (DELETE). The daemon owns persistence (~/.aifleet/provider.json + secrets.env).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/provider');
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/provider', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

export async function DELETE(): Promise<Response> {
  return proxy('/provider', { method: 'DELETE' });
}
