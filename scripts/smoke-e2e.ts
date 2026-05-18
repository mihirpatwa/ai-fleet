#!/usr/bin/env -S node --import tsx
// Full end-to-end smoke from a clean Vite+React+TS project. Drives REAL
// billed agents for up to ~15 min — run it deliberately (CI later), not on
// every change:
//
//   node --import tsx scripts/smoke-e2e.ts            # cleans up after
//   node --import tsx scripts/smoke-e2e.ts --keep     # leave the temp project
//
// Exits non-zero on the first failed assertion.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = process.argv.includes('--keep');
const DAEMON = process.env['AIFLEET_DAEMON_URL'] ?? 'http://127.0.0.1:7878';
const CLI = fileURLToPath(new URL('../cli/dist/index.js', import.meta.url));
const PROJ = mkdtempSync(join(tmpdir(), `aifleet-e2e-${Date.now()}-`));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sh(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}
function ai(args: string[], cwd: string): void {
  execFileSync(process.execPath, [CLI, ...args], { cwd, stdio: 'inherit' });
}
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(DAEMON + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}
function fail(msg: string): never {
  console.error(`[e2e] FAIL — ${msg}`);
  cleanup();
  process.exit(1);
}
function cleanup(): void {
  try {
    ai(['down'], PROJ);
  } catch {
    /* best effort */
  }
  if (!KEEP) rmSync(PROJ, { recursive: true, force: true });
  else console.log(`[e2e] kept project at ${PROJ}`);
}
function grepProject(re: RegExp): boolean {
  const stack = [join(PROJ, 'src')];
  while (stack.length) {
    const dir = stack.pop()!;
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && re.test(readFileSync(p, 'utf8'))) return true;
    }
  }
  return false;
}

interface Task {
  id: string;
  parentId: string | null;
  assignedAgent: string;
  status: string;
}

async function main(): Promise<void> {
  console.log(`[e2e] scaffolding Vite+React+TS in ${PROJ}`);
  sh('pnpm', ['create', 'vite', '.', '--', '--template', 'react-ts'], PROJ);
  sh('pnpm', ['install'], PROJ);

  ai(['init', '--profile', 'react'], PROJ);
  ai(['up'], PROJ);
  await getJson('/healthz');

  console.log('[e2e] submitting goal');
  ai(
    [
      'submit',
      'add a /about page with a title and a button that increments a counter shown on the page, with a Vitest test that asserts the count increments on click',
    ],
    PROJ,
  );

  // Poll the project's root task until terminal or 15 minutes.
  const deadline = Date.now() + 15 * 60_000;
  let tasks: Task[] = [];
  let rootStatus = 'queued';
  while (Date.now() < deadline) {
    tasks = await getJson<Task[]>(`/tasks?project_root=${encodeURIComponent(PROJ)}`);
    const root = tasks.find((t) => t.parentId === null);
    rootStatus = root?.status ?? 'queued';
    if (['done', 'failed', 'blocked', 'cancelled'].includes(rootStatus)) break;
    await sleep(5000);
  }

  // --- assertions ---
  if (rootStatus !== 'done') fail(`root task ended '${rootStatus}', expected 'done'`);
  if (!grepProject(/about/i) || !grepProject(/increment|count/i)) {
    fail('no /about component with a counter found in src/');
  }

  const test = spawnSync('pnpm', ['test'], { cwd: PROJ, encoding: 'utf8' });
  if (test.status !== 0) fail(`project Vitest suite did not pass\n${test.stdout}\n${test.stderr}`);

  if (tasks.some((t) => t.status === 'blocked')) fail('a task is blocked (security gate)');
  if (!tasks.some((t) => t.assignedAgent === 'retrospector')) {
    fail('no retrospector task ran for this project');
  }
  const mem = await getJson<unknown[]>(`/memory?project_root=${encodeURIComponent(PROJ)}`);
  if (mem.length < 1) fail('no memory entries recorded for this project');

  console.log(
    `[e2e] PASS — root done, /about+counter present, Vitest green, ` +
      `retrospector ran, ${mem.length} memory entr(y/ies)`,
  );
  cleanup();
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
