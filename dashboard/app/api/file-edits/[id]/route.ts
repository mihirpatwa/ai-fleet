// Proxy: full before/after + unified diff for one file edit (Code tab pane).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxy(`/file-edits/${encodeURIComponent(id)}`);
}
