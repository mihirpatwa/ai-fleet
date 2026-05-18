// SSE bridge. Browsers can't read the daemon's WebSocket directly, so the
// Next server holds ONE upstream ws://…/ws connection and fans every message
// out to all connected EventSource clients as `data: <json>\n\n`. The hub is
// stashed on globalThis so Next's dev HMR doesn't open a second upstream.
import WebSocket from 'ws';
import { DAEMON_WS } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Client = ReadableStreamDefaultController<Uint8Array>;

interface Hub {
  ws: WebSocket | null;
  clients: Set<Client>;
  retry: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __aifleetHub?: Hub };
const hub: Hub = (g.__aifleetHub ??= { ws: null, clients: new Set(), retry: null });
const enc = new TextEncoder();

function broadcast(chunk: string): void {
  const bytes = enc.encode(chunk);
  for (const c of hub.clients) {
    try {
      c.enqueue(bytes);
    } catch {
      hub.clients.delete(c);
    }
  }
}

function connectUpstream(): void {
  if (hub.ws || hub.clients.size === 0) return;
  const ws = new WebSocket(DAEMON_WS);
  hub.ws = ws;
  ws.on('message', (data: WebSocket.RawData) => broadcast(`data: ${data.toString()}\n\n`));
  const drop = (): void => {
    if (hub.ws === ws) hub.ws = null;
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
    // Reconnect only while clients are still listening.
    if (hub.clients.size > 0 && !hub.retry) {
      hub.retry = setTimeout(() => {
        hub.retry = null;
        connectUpstream();
      }, 2000);
    }
  };
  ws.on('close', drop);
  ws.on('error', drop);
}

export function GET(req: Request): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      hub.clients.add(controller);
      controller.enqueue(enc.encode(': connected\n\n'));
      connectUpstream();
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': ping\n\n'));
        } catch {
          clearInterval(ping);
        }
      }, 25_000);
      const close = (): void => {
        clearInterval(ping);
        hub.clients.delete(controller);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        if (hub.clients.size === 0 && hub.ws) {
          hub.ws.close();
          hub.ws = null;
        }
      };
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      // controller already removed in the abort handler
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
