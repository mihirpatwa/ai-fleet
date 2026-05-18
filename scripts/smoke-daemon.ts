#!/usr/bin/env -S node --import tsx
// End-to-end smoke test for the daemon. Black-box on purpose: it talks to a
// real `aifleet-daemon` over HTTP exactly as an operator would.
//
//   1. scratch project   — mkdir, npm init -y, git init
//   2. isolated config   — temp CLAUDE_CONFIG_DIR with our hooks installed,
//                          temp AIFLEET_HOME/DB so nothing real is touched
//   3. boot daemon       — wait for /healthz
//   4. POST a doc-writer task, poll /tasks/:id ≤ 90s
//   5. assert            — README.md exists + is one line; events table has
//                          tool_use_pre AND tool_use_post (hooks fired)
//   6. always tear down  — kill daemon, remove every temp dir
//
// Requires working Claude credentials in the environment (it runs a real
// agent). Exits non-zero with diagnostics on any failure.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHooks } from './install-hooks.ts';

const PORT = Number(process.env['AIFLEET_SMOKE_PORT'] ?? 7879);
const BASE = `http://127.0.0.1:${PORT}`;
const DAEMON_CWD = fileURLToPath(new URL('../daemon', import.meta.url));

const tmps: string[] = [];
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let daemon: ChildProcess | undefined;
function cleanup(): void {
  if (daemon && daemon.exitCode === null) {
    daemon.kill('SIGTERM');
    setTimeout(() => daemon?.kill('SIGKILL'), 3000).unref();
  }
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const h = (await getJson('/healthz')) as { ok?: boolean };
      if (h.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`daemon did not become healthy within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const project = scratch('aifleet-smoke-proj-');
  const home = scratch('aifleet-smoke-home-');
  const cfgDir = scratch('aifleet-smoke-cfg-');

  execFileSync('npm', ['init', '-y'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' });

  // Hooks live in the isolated CLAUDE_CONFIG_DIR the spawned SDK reads via
  // settingSources:['user'] — the real ~/.claude is never modified.
  const settingsFile = join(cfgDir, 'settings.json');
  installHooks({ path: settingsFile, port: PORT });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: cfgDir,
    AIFLEET_HOME: home,
    AIFLEET_DB_PATH: join(home, 'state.db'),
    // Load the repo's agent definitions instead of ~/.claude/agents.
    AIFLEET_AGENTS_DIR: fileURLToPath(new URL('../agents', import.meta.url)),
    AIFLEET_PORT: String(PORT),
  };

  console.log(`[smoke] starting daemon on :${PORT} (cwd=${DAEMON_CWD})`);
  daemon = spawn('npm', ['run', '--silent', 'daemon:dev', '--', '--port', String(PORT)], {
    cwd: DAEMON_CWD,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  daemon.on('exit', (code, sig) => {
    if (code && code !== 0) console.error(`[smoke] daemon exited early code=${code} sig=${sig}`);
  });

  await waitForHealth(30_000);
  console.log('[smoke] daemon healthy; creating doc-writer task');

  const createRes = await fetch(BASE + '/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goal: 'add a one-line README to this project',
      project_root: project,
      agent: 'doc-writer',
    }),
  });
  if (createRes.status !== 201) {
    throw new Error(`POST /tasks → ${createRes.status}: ${await createRes.text()}`);
  }
  const task = (await createRes.json()) as { id: string };
  console.log(`[smoke] task ${task.id} created; polling (≤90s)`);

  const deadline = Date.now() + 90_000;
  let status = 'queued';
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    const t = (await getJson(`/tasks/${task.id}`)) as { status: string; error: string | null };
    status = t.status;
    lastError = t.error;
    if (status === 'done') break;
    if (status === 'failed' || status === 'blocked' || status === 'cancelled') {
      throw new Error(`task ended ${status}: ${lastError ?? 'no error recorded'}`);
    }
    await sleep(2000);
  }
  if (status !== 'done') throw new Error(`task did not finish in 90s (last status: ${status})`);

  // Assert: README.md exists and is a single line.
  const readme = join(project, 'README.md');
  if (!existsSync(readme)) throw new Error('README.md was not created');
  const lines = readFileSync(readme, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`expected a one-line README, got ${lines.length} non-empty line(s)`);
  }

  // Assert: hooks streamed both tool_use phases into the events table.
  const events = (await getJson(`/events?task_id=${task.id}`)) as Array<{ type: string }>;
  const types = new Set(events.map((e) => e.type));
  for (const required of ['tool_use_pre', 'tool_use_post']) {
    if (!types.has(required)) {
      throw new Error(`events table missing ${required} (saw: ${[...types].join(', ') || 'none'})`);
    }
  }

  console.log(
    `[smoke] PASS — README OK ("${lines[0]?.slice(0, 60)}"), ${events.length} events incl. tool_use_pre/post`,
  );
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`[smoke] FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
