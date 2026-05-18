// Proxy: pin/unpin a memory (daemon is the single writer).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await req.text();
  return proxy(`/memory/${encodeURIComponent(id)}/pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
