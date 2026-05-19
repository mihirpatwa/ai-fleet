// Proxy: median recent cost for an agent (SubmitGoal cost preview).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return proxy(`/cost/estimate${qs}`);
}
