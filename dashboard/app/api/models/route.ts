// Proxy: the daemon's dynamic model registry (phase 13).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return proxy('/models');
}
