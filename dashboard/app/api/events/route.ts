// Proxy for the daemon's event log. GET ?task_id=&since= forwards through.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return proxy(`/events${qs}`);
}
