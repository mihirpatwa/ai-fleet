// Proxy: cancel a task (daemon flips it to `cancelled`).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxy(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}
