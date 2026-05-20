// Phase 18e proxy: PUT upserts an MCP server (toggle preset or edit custom);
// DELETE removes a stored row.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  const body = await req.text();
  return proxy(`/mcp-servers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  return proxy(`/mcp-servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}
