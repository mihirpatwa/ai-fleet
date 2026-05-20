// Phase 18 proxy: list of all known AI providers with metadata for the
// first-run modal (logo, tagline, available flag, capabilities).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/providers');
}
