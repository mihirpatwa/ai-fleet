// Filesystem + URL anchors. Everything is resolved from this module's own
// location so a globally-linked `ai-fleet` still finds the fleet repo it was
// linked from. Env vars override for non-default deployments.
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // <fleet>/cli/dist/lib
export const cliRoot = resolve(here, '..', '..'); // <fleet>/cli
export const fleetRoot = process.env['AIFLEET_ROOT'] ?? resolve(cliRoot, '..');

export const DAEMON_PORT = Number(process.env['AIFLEET_DAEMON_PORT'] ?? 7878);
export const DASHBOARD_PORT = Number(process.env['AIFLEET_DASHBOARD_PORT'] ?? 3737);
export const daemonUrl = process.env['AIFLEET_DAEMON_URL'] ?? `http://127.0.0.1:${DAEMON_PORT}`;
export const daemonWsUrl = daemonUrl.replace(/^http/, 'ws') + '/ws';
export const dashboardUrl =
  process.env['AIFLEET_DASHBOARD_URL'] ?? `http://localhost:${DASHBOARD_PORT}`;

export const paths = {
  daemonEntry: join(fleetRoot, 'daemon', 'dist', 'cli', 'run.js'),
  aifleetDb: join(fleetRoot, 'daemon', 'dist', 'cli', 'db.js'),
  dashboardDir: join(fleetRoot, 'dashboard'),
  nextBin: join(fleetRoot, 'dashboard', 'node_modules', 'next', 'dist', 'bin', 'next'),
  profilesDir: join(fleetRoot, 'profiles'),
  agentsDir: join(fleetRoot, 'agents'),
  installHooks: join(fleetRoot, 'scripts', 'install-hooks.ts'),
  linkAgents: join(fleetRoot, 'scripts', 'link-agents.sh'),
  claudeAgentsDir: join(homedir(), '.claude', 'agents'),
  claudeSettings:
    process.env['CLAUDE_SETTINGS_PATH'] ?? join(homedir(), '.claude', 'settings.json'),
  aifleetHome: process.env['AIFLEET_HOME'] ?? join(homedir(), '.aifleet'),
  stateDb: process.env['AIFLEET_DB_PATH'] ?? join(homedir(), '.aifleet', 'state.db'),
} as const;

export function projectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, '.aifleet.yaml');
}
