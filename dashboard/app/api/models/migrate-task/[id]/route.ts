// Proxy: one-click migrate a model-deprecated blocked task to the default.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxy(`/models/migrate-task/${encodeURIComponent(id)}`, { method: 'POST' });
}
