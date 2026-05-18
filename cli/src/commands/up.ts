import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import ora from 'ora';
import { execa } from 'execa';
import {
  DAEMON_PORT,
  DASHBOARD_PORT,
  daemonUrl,
  dashboardUrl,
  fleetRoot,
  paths,
} from '../lib/paths.js';
import { getJson, reachable, waitFor } from '../lib/http.js';
import * as pm2 from '../lib/pm2.js';

export async function up(): Promise<void> {
  if (!existsSync(paths.daemonEntry)) {
    console.error(pc.red(`daemon build missing: ${paths.daemonEntry}\nRun: pnpm -r build`));
    process.exitCode = 1;
    return;
  }

  if (!existsSync(join(paths.dashboardDir, '.next'))) {
    const s = ora('building dashboard (first run, ~30s)').start();
    try {
      await execa(process.execPath, [paths.nextBin, 'build'], { cwd: paths.dashboardDir });
      s.succeed('dashboard built');
    } catch (err) {
      s.fail('dashboard build failed');
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
  }

  const spin = ora('starting daemon + dashboard under pm2').start();
  await pm2.start({
    name: 'aifleet-daemon',
    script: paths.daemonEntry,
    args: ['--port', String(DAEMON_PORT)],
    cwd: fleetRoot,
  });
  await pm2.start({
    name: 'aifleet-dashboard',
    script: paths.nextBin,
    args: ['start', '-p', String(DASHBOARD_PORT)],
    cwd: paths.dashboardDir,
  });
  spin.text = 'waiting for health (daemon /healthz, dashboard /)';

  const daemonOk = await waitFor(
    async () => {
      try {
        return (await getJson<{ ok?: boolean }>('/healthz')).ok === true;
      } catch {
        return false;
      }
    },
    { timeoutMs: 15000, intervalMs: 1000 },
  );
  const dashOk = await waitFor(() => reachable(dashboardUrl), {
    timeoutMs: 20000,
    intervalMs: 1000,
  });

  if (daemonOk && dashOk) {
    spin.succeed('fleet up');
  } else {
    spin.fail(
      `health check failed (daemon ${daemonOk ? 'ok' : 'down'}, dashboard ${dashOk ? 'ok' : 'down'})`,
    );
    console.error(pc.dim('inspect with: pm2 logs aifleet-daemon | aifleet-dashboard'));
    process.exitCode = 1;
  }

  const st = await pm2.status();
  console.log(
    `  aifleet-daemon    ${st['aifleet-daemon'] ?? 'unknown'}  (${daemonUrl})\n` +
      `  aifleet-dashboard ${st['aifleet-dashboard'] ?? 'unknown'}`,
  );
  console.log(pc.bold(`\ndashboard: ${dashboardUrl}`));
}
