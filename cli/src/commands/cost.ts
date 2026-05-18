import pc from 'picocolors';
import { execa } from 'execa';
import { fleetRoot, paths } from '../lib/paths.js';

export async function cost(opts: {
  today?: boolean;
  week?: boolean;
  month?: boolean;
}): Promise<void> {
  const since = opts.month ? '1m' : opts.week ? '1w' : '1d';
  try {
    await execa(process.execPath, [paths.aifleetDb, 'cost', '--since', since], {
      cwd: fleetRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(pc.red(`cost query failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
