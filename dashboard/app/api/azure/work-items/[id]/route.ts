// Phase 18g proxy: full Azure work-item detail with attachments + relations.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return proxy(`/azure/work-items/${encodeURIComponent(id)}`);
}
