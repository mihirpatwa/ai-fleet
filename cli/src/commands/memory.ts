import pc from 'picocolors';
import { execa } from 'execa';
import { fleetRoot, paths } from '../lib/paths.js';

/** Delegate to `aifleet-db memory <args>` (same pattern as `ai-fleet cost`). */
export async function memory(args: string[]): Promise<void> {
  try {
    await execa(process.execPath, [paths.aifleetDb, 'memory', ...args], {
      cwd: fleetRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(pc.red(`memory: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
