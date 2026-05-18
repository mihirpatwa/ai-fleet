// Where the phase-4 daemon lives. The dashboard's /api/* routes proxy here;
// /api/stream bridges its WebSocket. Overridable for non-local daemons.
export const DAEMON_HTTP = process.env['AIFLEET_DAEMON_URL'] ?? 'http://127.0.0.1:7878';
export const DAEMON_WS =
  process.env['AIFLEET_DAEMON_WS'] ?? DAEMON_HTTP.replace(/^http/, 'ws') + '/ws';

/** Proxy a request to the daemon, passing the body/status straight through. */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(`${DAEMON_HTTP}${path}`, { ...init, cache: 'no-store' });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'daemon unreachable', daemon: DAEMON_HTTP }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
