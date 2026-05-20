// Phase 18e p4 proxy: health probe for an MCP server. The daemon spawns the
// command for up to 4s and reports alive = healthy.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  return proxy(`/mcp-servers/${encodeURIComponent(name)}/probe`, { method: 'POST' });
}
