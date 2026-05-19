#!/usr/bin/env -S node --import tsx
// Phase-14 directory-resolver smoke. Mock/$0/deterministic: NO browser, NO
// Playwright (showDirectoryPicker opens a native OS dialog that can't be
// driven headless — that path is manual-QA only). Boots an isolated daemon
// with a parked scheduler (huge poll_interval ⇒ queued tasks never dispatch ⇒
// no agent/SDK/cost) and asserts the HTTP surface:
//
//   1. /resolve-path typed → success absolute_path
//   2. /resolve-path /etc  → 400 (phase-8 hard denylist)
//   3. /resolve-path bogus → 400 (not a directory)
//   4. /resolve-path handle-mode (search roots) → resolves a temp project
//   5. recent_projects: POST /tasks ×2 ⇒ submission_count 1→2; DELETE ⇒ gone
//
// Exits non-zero with diagnostics on any failure.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env['AIFLEET_SMOKE_PORT'] ?? 7887);
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
function killTree(signal: NodeJS.Signals): void {
  if (!daemon?.pid || daemon.exitCode !== null) return;
  try {
    process.kill(-daemon.pid, signal);
  } catch {
    try {
      daemon.kill(signal);
    } catch {
      /* gone */
    }
  }
}
function cleanup(): void {
  killTree('SIGKILL');
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
async function j(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const h = await j('/healthz');
      if (h.status === 200 && (h.body as { ok?: boolean }).ok) return;
    } catch {
      /* not up */
    }
    await sleep(500);
  }
  throw new Error(`daemon not healthy within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const home = scratch('aifleet-dir-home-');
  const searchRoot = scratch('aifleet-dir-root-');
  // A project that handle-mode search must find under searchRoot.
  const proj = join(searchRoot, 'myproj');
  mkdirSync(proj);
  writeFileSync(join(proj, 'package.json'), '{}');
  writeFileSync(join(proj, 'README.md'), '#');

  // Park the scheduler (no agent runs) + scope the search roots to our temp.
  writeFileSync(
    join(home, 'config.yaml'),
    `poll_interval_ms: 3600000\ndirectory_search_roots: ['${searchRoot}']\n`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AIFLEET_HOME: home,
    AIFLEET_DB_PATH: join(home, 'state.db'),
  };

  console.log(`[smoke-dirs] starting daemon :${PORT}`);
  daemon = spawn('npm', ['run', '--silent', 'daemon:dev', '--', '--port', String(PORT)], {
    cwd: DAEMON_CWD,
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForHealth(30_000);

  // 1. typed path → success
  const ok = await j('/resolve-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type_path: proj }),
  });
  assert(
    ok.status === 200 && ok.body.status === 'success' && ok.body.absolute_path === proj,
    `typed resolve failed: ${JSON.stringify(ok.body)}`,
  );

  // 2. /etc → 400 hard-denylist
  const etc = await j('/resolve-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type_path: '/etc' }),
  });
  assert(
    etc.status === 400 && /denylist|not allowed/i.test(String(etc.body.error)),
    `/etc should be 400 denied, got ${etc.status} ${JSON.stringify(etc.body)}`,
  );

  // 3. bogus → 400 not a dir
  const bogus = await j('/resolve-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type_path: '/no/such/dir/zzz' }),
  });
  assert(bogus.status === 400, `bogus path expected 400, got ${bogus.status}`);

  // 4. handle-mode search (basename + entry-overlap) under searchRoot
  const handle = await j('/resolve-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hint_name: 'myproj', hint_entries: ['package.json', 'README.md'] }),
  });
  assert(
    handle.status === 200 && handle.body.status === 'success' && handle.body.absolute_path === proj,
    `handle-mode resolve failed: ${JSON.stringify(handle.body)}`,
  );

  // 5. recent_projects: empty → submit ×2 → count 1→2 → delete → gone
  const empty = await j('/recent-projects');
  assert(Array.isArray(empty.body) && empty.body.length === 0, 'recent-projects should start empty');

  for (let n = 1; n <= 2; n++) {
    const t = await j('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: `noop ${n}`, project_root: proj, agent: 'doc-writer' }),
    });
    assert(t.status === 201, `POST /tasks → ${t.status}`);
    const list = await j('/recent-projects');
    const row = (list.body as { absolutePath: string; submissionCount: number }[]).find(
      (r) => r.absolutePath === proj,
    );
    assert(
      row !== undefined && row.submissionCount === n,
      `submission_count expected ${n}, got ${JSON.stringify(row)}`,
    );
  }

  const del = await j(`/recent-projects?path=${encodeURIComponent(proj)}`, { method: 'DELETE' });
  assert(del.status === 200 && del.body.ok === true, `DELETE failed: ${JSON.stringify(del.body)}`);
  const after = await j('/recent-projects');
  assert(
    (after.body as { absolutePath: string }[]).every((r) => r.absolutePath !== proj),
    'recent project still present after delete',
  );

  console.log('[smoke-dirs] PASS — typed+denylist+handle resolve, recents count++/delete');
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`[smoke-dirs] FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
