// Phase 18g: dynamic state filter — distinct states per work-item type, from
// the connected Azure project (respects custom workflows).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return proxy(`/azure/states?${url.searchParams.toString()}`);
}
