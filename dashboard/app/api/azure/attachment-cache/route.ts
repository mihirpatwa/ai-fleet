// t4: attachment-cache stats (GET) + manual flush (DELETE).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/azure/attachment-cache');
}
export async function DELETE(): Promise<Response> {
  return proxy('/azure/attachment-cache', { method: 'DELETE' });
}
