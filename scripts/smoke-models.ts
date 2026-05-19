#!/usr/bin/env -S node --import tsx
// Phase-13 model-selection smoke. Mock + fixtures on purpose: NO real agent
// runs, NO Anthropic key, $0, deterministic. It boots a real daemon against an
// isolated AIFLEET_HOME/DB (bundled model list, since no key) and exercises:
//
//   1. GET  /models                 → ≥3 entries w/ display_name + pricing
//   2. PUT  /models/agent/coder     → claude-haiku-4-5 sticks (/models/active)
//   3. PUT  /models/agent/coder     → bogus id ⇒ 400 + useful error
//   4. POST /tasks (agent=coder)    → no override stored; resolveModel→haiku
//   5. POST /tasks (model_override) → override stored; resolveModel→opus
//   6. seed an agent_runs fixture   → GET /cost/estimate returns a median
//   7. POST /models/refresh         → still serves the list
//
// A huge poll_interval keeps the loop from ever dispatching the queued tasks,
// so no SDK/agent is invoked. Exits non-zero with diagnostics on any failure.
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env['AIFLEET_SMOKE_PORT'] ?? 7881);
const BASE = `http://127.0.0.1:${PORT}`;
const DAEMON_CWD = fileURLToPath(new URL('../daemon', import.meta.url));
const require = createRequire(join(DAEMON_CWD, 'package.json'));

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
  // `npm run daemon:dev` is npm → tsx → node; killing npm orphans the real
  // daemon. With detached:true the child leads its own process group, so a
  // negative pid signals the whole tree.
  try {
    process.kill(-daemon.pid, signal);
  } catch {
    try {
      daemon.kill(signal);
    } catch {
      /* already gone */
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
  const project = scratch('aifleet-mdl-proj-');
  const home = scratch('aifleet-mdl-home-');
  // Park the scheduler so queued tasks are never dispatched (no agent runs).
  writeFileSync(join(home, 'config.yaml'), 'poll_interval_ms: 3600000\n');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AIFLEET_HOME: home,
    AIFLEET_DB_PATH: join(home, 'state.db'),
  };
  delete env['ANTHROPIC_API_KEY']; // force the bundled list (deterministic)

  console.log(`[smoke-models] starting daemon :${PORT}`);
  // stdio fully ignored: inheriting the daemon's stdout into a parent pipe
  // (e.g. `| tail`) keeps that pipe open after we exit, so the orphaned
  // daemon hangs the wrapper. We assert over HTTP and print our own result.
  daemon = spawn('npm', ['run', '--silent', 'daemon:dev', '--', '--port', String(PORT)], {
    cwd: DAEMON_CWD,
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForHealth(30_000);

  // 1. GET /models
  const models = await j('/models');
  assert(models.status === 200 && Array.isArray(models.body), 'GET /models not an array');
  assert(models.body.length >= 3, `expected ≥3 models, got ${models.body.length}`);
  const priced = models.body.filter(
    (m: any) => m.display_name && m.pricing && typeof m.pricing.input_per_mtok === 'number',
  );
  assert(priced.length >= 3, `expected ≥3 models with display_name + pricing, got ${priced.length}`);

  // 2. PUT /models/agent/coder → haiku
  const put = await j('/models/agent/coder', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: 'claude-haiku-4-5' }),
  });
  assert(put.status === 200, `PUT coder → ${put.status}`);
  const active1 = await j('/models/active');
  assert(
    active1.body.per_agent?.coder === 'claude-haiku-4-5',
    `active.per_agent.coder = ${active1.body.per_agent?.coder}`,
  );

  // 3. bogus id ⇒ 400
  const bogus = await j('/models/agent/coder', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: 'gpt-9' }),
  });
  assert(bogus.status === 400, `bogus PUT expected 400, got ${bogus.status}`);
  assert(
    typeof bogus.body.error === 'string' && Array.isArray(bogus.body.valid),
    'bogus PUT missing useful error/valid list',
  );

  // 4. POST /tasks agent=coder, no override
  const t1 = await j('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'noop A', project_root: project, agent: 'coder' }),
  });
  assert(t1.status === 201, `POST /tasks → ${t1.status}`);
  const t1full = await j(`/tasks/${t1.body.id}`);
  assert(
    t1full.body.inputJson && t1full.body.inputJson.model_override === undefined,
    'task1 should NOT carry a model_override',
  );

  // 5. POST /tasks with model_override
  const t2 = await j('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goal: 'noop B',
      project_root: project,
      agent: 'coder',
      model_override: 'claude-opus-4-7',
    }),
  });
  const t2full = await j(`/tasks/${t2.body.id}`);
  assert(
    t2full.body.inputJson?.model_override === 'claude-opus-4-7',
    `task2.model_override = ${t2full.body.inputJson?.model_override}`,
  );

  // Model resolution is proven end-to-end through the daemon itself: step 2
  // set per_agent.coder=haiku (the daemon's resolveModel reads model_selection
  // on spawn) and step 5 stored model_override in the task input_json. We do
  // NOT import daemon/dist/spawn.js here — it drags the agent SDK at module
  // load, which hangs a black-box smoke.

  // 6. agent_runs fixture → cost estimate
  const Database = require('better-sqlite3') as new (p: string) => {
    prepare(sql: string): { run: (...a: unknown[]) => unknown };
    close(): void;
  };
  const db = new Database(join(home, 'state.db'));
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  for (const [i, c] of [0.1, 0.12, 0.2].entries()) {
    db.prepare(
      `INSERT INTO agent_runs (id, task_id, agent, model, cost_usd, status, started_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(`SMK${i}`, null, 'coder', 'claude-haiku-4-5', c, 'success', now);
  }
  db.close();
  const est = await j('/cost/estimate?agent=coder');
  assert(
    est.body.estimateUsd != null && est.body.samples >= 3,
    `cost estimate missing (got ${JSON.stringify(est.body)})`,
  );
  const none = await j('/cost/estimate?agent=nobody-here');
  assert(none.body.estimateUsd === null, 'cost estimate should be null for an unseen agent');

  // 8. refresh still serves the list
  const refreshed = await j('/models/refresh', { method: 'POST' });
  assert(
    refreshed.status === 200 && Array.isArray(refreshed.body.data) && refreshed.body.data.length >= 3,
    'POST /models/refresh did not return the list',
  );

  console.log(
    `[smoke-models] PASS — ${models.body.length} models, coder→haiku, override→opus, ` +
      `cost≈$${Number(est.body.estimateUsd).toFixed(2)} (${est.body.samples} runs)`,
  );
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
// `timeout`/kill send SIGTERM — tear the daemon down or it orphans.
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`[smoke-models] FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
