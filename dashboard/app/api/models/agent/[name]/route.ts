// Proxy: set the model for an agent (or `default`/`orchestrator`).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await ctx.params;
  const body = await req.text();
  return proxy(`/models/agent/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
