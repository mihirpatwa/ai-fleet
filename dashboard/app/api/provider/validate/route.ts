// Phase 18 proxy: cheap credential probe used by the connect modal so we
// don't persist a bad API key. Body shape matches POST /api/provider.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/provider/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
