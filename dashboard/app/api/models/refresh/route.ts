// Proxy: force a model-list refetch from Anthropic (or bundled/cached).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(): Promise<Response> {
  return proxy('/models/refresh', { method: 'POST' });
}
