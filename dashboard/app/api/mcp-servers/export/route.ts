// q9: MCP marketplace export — stored rows only (presets reload on import).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/mcp-servers/export');
}
