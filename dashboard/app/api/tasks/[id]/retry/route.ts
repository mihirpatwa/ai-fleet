// Proxy: retry a failed task (daemon requeues it).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxy(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}
