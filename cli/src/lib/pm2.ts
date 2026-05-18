// PM2 control via its CLI (execa). We shell out rather than use the
// programmatic API so process state lives in the user's normal ~/.pm2 daemon,
// inspectable with a plain `pm2 ls`.
import { createRequire } from 'node:module';
import { execa } from 'execa';

const require = createRequire(import.meta.url);
const PM2_BIN = require.resolve('pm2/bin/pm2');

async function pm2(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  const res = await execa(process.execPath, [PM2_BIN, ...args], {
    reject: false,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  return res.stdout ?? '';
}

export interface ProcSpec {
  name: string;
  script: string;
  args: string[];
  cwd: string;
}

/** (Re)start a process under a stable name — delete-then-start for a clean slate. */
export async function start(spec: ProcSpec): Promise<void> {
  await pm2(['delete', spec.name]); // ignored if absent
  await pm2(
    [
      'start',
      spec.script,
      '--name',
      spec.name,
      '--interpreter',
      process.execPath,
      '--',
      ...spec.args,
    ],
    { cwd: spec.cwd },
  );
}

export async function stop(names: string[]): Promise<void> {
  for (const n of names) await pm2(['delete', n]);
}

interface Pm2ListEntry {
  name?: string;
  pm2_env?: { status?: string };
}

export async function status(): Promise<Record<string, string>> {
  const out = await pm2(['jlist']);
  try {
    const list = JSON.parse(out) as Pm2ListEntry[];
    const map: Record<string, string> = {};
    for (const p of list) if (p.name) map[p.name] = p.pm2_env?.status ?? 'unknown';
    return map;
  } catch {
    return {};
  }
}

export async function isOnline(name: string): Promise<boolean> {
  return (await status())[name] === 'online';
}
