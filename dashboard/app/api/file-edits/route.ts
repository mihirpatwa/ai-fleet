// Proxy for the daemon's file-edit list (phase 12 Code tab). GET ?task_id=.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return proxy(`/file-edits${qs}`);
}
