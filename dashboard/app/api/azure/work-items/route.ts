// Phase 18g proxy: list Azure work items filtered by type/state/assignee/search.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return proxy(`/azure/work-items?${url.searchParams.toString()}`);
}
