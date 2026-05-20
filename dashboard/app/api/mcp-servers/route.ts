// Phase 18e proxy: GET — merged list of MCP servers (presets + user customs).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/mcp-servers');
}
