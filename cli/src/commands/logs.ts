import { WebSocket } from 'undici';
import pc from 'picocolors';
import { daemonWsUrl } from '../lib/paths.js';
import { roleColor } from '../lib/render.js';

interface EventRow {
  id: number;
  taskId: string | null;
  agent: string | null;
  type: string;
  payloadJson: unknown;
  ts: string;
}

export function logs(opts: { agent?: string; task?: string; follow?: boolean }): void {
  const ws = new WebSocket(daemonWsUrl);

  ws.addEventListener('open', () => {
    console.log(
      pc.dim(
        `connected to ${daemonWsUrl}` +
          (opts.agent ? ` · agent=${opts.agent}` : '') +
          (opts.task ? ` · task=${opts.task}` : '') +
          ' — live events, Ctrl-C to exit',
      ),
    );
  });

  ws.addEventListener('message', (ev) => {
    let e: EventRow;
    try {
      e = JSON.parse(String((ev as { data: unknown }).data)) as EventRow;
    } catch {
      return;
    }
    if (opts.task && e.taskId !== opts.task) return;
    if (opts.agent && e.agent !== opts.agent) return;
    const payload = e.payloadJson == null ? '' : JSON.stringify(e.payloadJson);
    console.log(
      `${pc.dim(e.ts)}  ${pc.bold(e.type)}  ${roleColor(e.agent ?? '')(e.agent ?? '-')}  ` +
        `${pc.dim(e.taskId ?? '-')}  ${pc.dim(payload)}`,
    );
  });

  ws.addEventListener('error', () => {
    console.error(pc.red(`cannot connect to ${daemonWsUrl} — is the daemon up?`));
    process.exitCode = 1;
  });
  ws.addEventListener('close', () => {
    if (!opts.follow) process.exit(0);
    console.error(pc.yellow('stream closed by daemon'));
  });

  process.on('SIGINT', () => {
    ws.close();
    process.exit(0);
  });
}
