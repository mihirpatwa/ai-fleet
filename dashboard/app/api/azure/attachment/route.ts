// Phase 18g: streaming proxy for Azure attachments (PAT-authed). Lets the
// drawer render inline images/videos without the browser ever seeing the PAT.
//
// IMPORTANT: do NOT use the `proxy()` helper here — it slurps the body via
// `await res.text()`, which corrupts binary content (images / video). We
// stream the daemon response straight through to the client instead.
import { DAEMON_HTTP } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const inUrl = new URL(req.url);
  const target = `${DAEMON_HTTP}/azure/attachment?${inUrl.searchParams.toString()}`;
  try {
    const res = await fetch(target, { cache: 'no-store' });
    return new Response(res.body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        'cache-control': 'private, max-age=300',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'daemon unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
