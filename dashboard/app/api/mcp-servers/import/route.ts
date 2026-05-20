// q9: MCP marketplace import. Body: { servers: McpServerConfig[], mode? }.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/mcp-servers/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
