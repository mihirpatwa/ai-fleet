#!/usr/bin/env -S node --import tsx
// Phase-11 step-10 acceptance: headless-Chromium dashboard smoke. Isolated +
// $0: a temp AIFLEET_HOME/DB, a daemon with a PARKED scheduler (huge
// poll_interval ⇒ the submitted goal stays queued in Backlog and is cancelled
// before any agent/SDK/cost), the built dashboard on :3838.
//
// Asserts: dark-toggle screenshot @1440x900; Sider collapsed @768; hamburger +
// horizontal board scroll @375; no FOUC on a dark reload (bg stable ≤200ms);
// submit a goal → card in Backlog → cancel. PASS = all green, no console errors.
//
// Chromium-only by design (showDirectoryPicker / multi-engine are out of scope
// here). Requires `playwright install chromium` (done by the phase-B step).
import { chromium, type ConsoleMessage } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DPORT = Number(process.env['AIFLEET_SMOKE_PORT'] ?? 7889);
const WEB = Number(process.env['AIFLEET_SMOKE_WEB'] ?? 3838);
const DAEMON_CWD = fileURLToPath(new URL('../daemon', import.meta.url));
const DASH_CWD = fileURLToPath(new URL('../dashboard', import.meta.url));

const tmps: string[] = [];
function scratch(p: string): string {
  const d = mkdtempSync(join(tmpdir(), p));
  tmps.push(d);
  return d;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const procs: ChildProcess[] = [];
function killTree(c: ChildProcess, sig: NodeJS.Signals): void {
  if (!c.pid || c.exitCode !== null) return;
  try {
    process.kill(-c.pid, sig);
  } catch {
    try {
      c.kill(sig);
    } catch {
      /* gone */
    }
  }
}
function cleanup(): void {
  for (const c of procs) killTree(c, 'SIGKILL');
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
async function waitUrl(url: string, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 200) return;
    } catch {
      /* not up */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function main(): Promise<void> {
  const home = scratch('aifleet-dash-home-');
  const project = scratch('aifleet-dash-proj-');
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(home, 'config.yaml'), 'poll_interval_ms: 3600000\n');
  const dbPath = join(home, 'state.db');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AIFLEET_HOME: home,
    AIFLEET_DB_PATH: dbPath,
  };

  console.log(`[smoke-dashboard] daemon :${DPORT}, web :${WEB}`);
  const daemon = spawn(
    'npm',
    ['run', '--silent', 'daemon:dev', '--', '--port', String(DPORT)],
    { cwd: DAEMON_CWD, env, detached: true, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  procs.push(daemon);
  await waitUrl(`http://127.0.0.1:${DPORT}/healthz`, 30_000);

  // Dashboard reads the SAME sqlite directly (lib/db) + proxies to the daemon.
  const web = spawn(
    'node',
    ['node_modules/next/dist/bin/next', 'start', '-p', String(WEB)],
    {
      cwd: DASH_CWD,
      env: { ...env, AIFLEET_DAEMON_URL: `http://127.0.0.1:${DPORT}` },
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  procs.push(web);
  await waitUrl(`http://localhost:${WEB}/`, 40_000);

  const errors: string[] = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  const base = `http://localhost:${WEB}`;
  const proj = encodeURIComponent(project);

  // --- load + dark toggle screenshot @1440x900 ---
  await page.goto(`${base}/?project=${proj}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('ai-fleet', { exact: false }).first().waitFor();
  await page.getByRole('radio', { name: 'Dark' }).click().catch(async () => {
    await page.getByText('Dark', { exact: true }).first().click();
  });
  await sleep(300);
  const shot = join(tmps[0]!, 'dark-1440.png');
  await page.screenshot({ path: shot });

  // --- no FOUC: reload in dark, bg stable within 200ms ---
  await page.evaluate(() =>
    localStorage.setItem('aifleet-theme', JSON.stringify({ state: { mode: 'dark' }, version: 0 })),
  );
  await page.goto(`${base}/?project=${proj}`, { waitUntil: 'commit' });
  const bg0 = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  await sleep(200);
  const bg1 = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  assert(bg0 === bg1, `FOUC: background changed within 200ms (${bg0} → ${bg1})`);
  assert(/rgb\(\s*1?\d?,/.test(bg0) || bg0.includes('11, 13'), `dark bg unexpectedly light: ${bg0}`);

  // --- @768: Sider collapsed + hamburger present ---
  await page.setViewportSize({ width: 768, height: 1024 });
  await sleep(400);
  const siderW = await page
    .locator('.ant-layout-sider')
    .first()
    .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width)
    .catch(() => 0);
  // collapsedWidth=0; the residual ≤2px is just the Sider's 1px border.
  assert(siderW <= 2, `Sider should be collapsed (≈0) at 768, got ${siderW}`);
  await page.getByRole('button', { name: 'Open menu' }).waitFor({ state: 'visible' });

  // --- @375: hamburger visible + board horizontally scrollable ---
  await page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  await page.getByRole('button', { name: 'Open menu' }).waitFor({ state: 'visible' });

  // --- submit a goal → card in Backlog ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/?project=${proj}`, { waitUntil: 'domcontentloaded' });
  const goalText = `smoke faq ${Date.now()}`;
  await page.getByPlaceholder('submit a goal…').fill(goalText);
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByText(goalText, { exact: false }).first().waitFor({ timeout: 15_000 });

  // confirm it's queued (Backlog) then cancel so nothing can ever run
  const tasks = (await (await fetch(`http://127.0.0.1:${DPORT}/tasks?project_root=${proj}`)).json()) as Array<{
    id: string;
    status: string;
    title: string;
  }>;
  const t = tasks.find((x) => x.title === goalText);
  assert(t, 'submitted task not found via daemon');
  assert(t!.status === 'queued', `task should be queued (Backlog), is ${t!.status}`);
  await fetch(`http://127.0.0.1:${DPORT}/tasks/${t!.id}/cancel`, { method: 'POST' });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/?project=${proj}`, { waitUntil: 'domcontentloaded' });
  // The board track scrolls horizontally on mobile (content wider than view).
  const scrollable = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('div'));
    return els.some(
      (e) =>
        e.scrollWidth > e.clientWidth + 4 &&
        ['auto', 'scroll'].includes(getComputedStyle(e).overflowX),
    );
  });
  assert(scrollable, 'expected a horizontally scrollable board track at 375px');

  await browser.close();
  cleanup();

  assert(errors.length === 0, `console/page errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(`[smoke-dashboard] PASS — dark/FOUC/responsive/submit ok, screenshot ${shot}`);
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
    cleanup();
    console.error(`[smoke-dashboard] FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
