// Proxy: current per-agent model selections.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return proxy('/models/active');
}
