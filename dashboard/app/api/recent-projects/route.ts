// Proxy: recent project folders (phase 14). GET ?limit lists; DELETE ?path=
// removes one (absolute path passed as a query param — see daemon note).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return proxy(`/recent-projects${qs}`);
}

export function DELETE(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return proxy(`/recent-projects${qs}`, { method: 'DELETE' });
}
