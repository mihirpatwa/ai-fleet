// Phase 18e: MCP server registry. Users configure which external MCP servers
// the daemon offers to spawned agents (Chrome DevTools for the tester,
// Postgres for db work, GitHub for repo ops, etc.). State lives in
// ~/.aifleet/mcp-servers.json (override via AIFLEET_HOME); spawn.ts reads it
// per task and passes the enabled set as Claude SDK `options.mcpServers`.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { aifleetDir } from '../config.js';

export interface McpServerConfig {
  /** Stable id, used as the key in SDK options.mcpServers. */
  name: string;
  /** Friendly label for the Settings UI. */
  display_name?: string;
  /** Executable to spawn (e.g. `npx`). */
  command: string;
  /** CLI args for the executable. */
  args: string[];
  /** Optional environment merged on top of the daemon's env. */
  env?: Record<string, string>;
  /** Toggle from Settings; disabled servers are NOT passed to spawns. */
  enabled: boolean;
  /** True when the entry matches one of the bundled PRESETS — we can show a
   * subtler "Edit" UI vs. a custom "Edit + Delete". */
  preset?: boolean;
  /**
   * p5: per-agent allowlist. When empty/undefined every spawned agent gets
   * this MCP; otherwise only agents in this list do (tester gets Chrome,
   * coder doesn't, etc.). Empty array means "no agents" — effectively
   * disabled but kept for clarity in the UI.
   */
  allowed_agents?: string[];
}

export interface McpPreset extends Omit<McpServerConfig, 'enabled'> {
  /** Marketing copy shown on the Settings card. */
  description: string;
  /** Per-preset env-var requirements (e.g. GITHUB_TOKEN). */
  required_env?: string[];
}

/** Built-in catalog. User can enable any of these without typing commands. */
export const PRESETS: McpPreset[] = [
  {
    name: 'chrome-devtools',
    display_name: 'Chrome DevTools',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    description:
      'Drive a Chromium browser from agents — useful for the tester to verify UI changes end-to-end.',
    preset: true,
  },
  {
    name: 'playwright',
    display_name: 'Playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    description: 'Cross-browser automation. The tester can record + replay flows against the running app.',
    preset: true,
  },
  {
    name: 'github',
    display_name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    description: 'Read/write issues, PRs, files via the GitHub API. Needs GITHUB_PERSONAL_ACCESS_TOKEN.',
    required_env: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    preset: true,
  },
  {
    name: 'postgres',
    display_name: 'Postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    description: 'Inspect tables, run read-only queries. Needs DATABASE_URL.',
    required_env: ['DATABASE_URL'],
    preset: true,
  },
  {
    name: 'filesystem',
    display_name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    description: 'Sandboxed filesystem access beyond the project root. Use sparingly.',
    preset: true,
  },
];

/* ---------------------------- storage ----------------------------- */

const FILE = 'mcp-servers.json';

function storePath(): string {
  return join(aifleetDir(), FILE);
}

export function loadServers(): McpServerConfig[] {
  try {
    if (!existsSync(storePath())) return [];
    const raw = readFileSync(storePath(), 'utf8');
    const j = JSON.parse(raw) as { servers?: McpServerConfig[] };
    return Array.isArray(j.servers) ? j.servers : [];
  } catch {
    return [];
  }
}

export function saveServers(servers: McpServerConfig[]): void {
  mkdirSync(dirname(storePath()), { recursive: true });
  writeFileSync(storePath(), JSON.stringify({ servers }, null, 2), 'utf8');
}

/* ----------------------------- helpers ---------------------------- */

/** All servers merged with presets (presets without a stored row come in as
 * disabled defaults so the UI can show them as toggleable). */
export function listMergedServers(): McpServerConfig[] {
  const stored = loadServers();
  const byName = new Map(stored.map((s) => [s.name, s]));
  const out: McpServerConfig[] = [];
  for (const p of PRESETS) {
    const ex = byName.get(p.name);
    if (ex) {
      out.push({ ...ex, preset: true });
      byName.delete(p.name);
    } else {
      out.push({
        name: p.name,
        ...(p.display_name ? { display_name: p.display_name } : {}),
        command: p.command,
        args: p.args,
        enabled: false,
        preset: true,
      });
    }
  }
  // Append any custom (non-preset) servers the user added.
  for (const custom of byName.values()) out.push(custom);
  return out;
}

/**
 * Enabled servers in the shape Claude SDK options.mcpServers expects.
 * `agent` filters by per-server allowlist (p5): undefined = no agent context
 * (returns every enabled server); otherwise only servers whose allowlist
 * includes `agent` are returned. Servers without an allowlist are always
 * included.
 */
export function buildSdkMcpServers(
  agent?: string,
): Record<string, { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }> {
  const enabled = listMergedServers().filter((s) => {
    if (!s.enabled) return false;
    if (!agent) return true;
    if (!s.allowed_agents || s.allowed_agents.length === 0) return true;
    return s.allowed_agents.includes(agent);
  });
  const out: Record<
    string,
    { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  > = {};
  for (const s of enabled) {
    out[s.name] = {
      type: 'stdio',
      command: s.command,
      args: s.args,
      ...(s.env ? { env: s.env } : {}),
    };
  }
  return out;
}

/** Upsert one server entry (preset toggle or custom add/edit). */
export function upsertServer(next: McpServerConfig): McpServerConfig[] {
  const all = loadServers();
  const idx = all.findIndex((s) => s.name === next.name);
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  saveServers(all);
  return listMergedServers();
}

export function deleteServer(name: string): McpServerConfig[] {
  const all = loadServers().filter((s) => s.name !== name);
  saveServers(all);
  return listMergedServers();
}

/* ---------------------------- p4 health probe ---------------------------- */

export interface ProbeResult {
  ok: boolean;
  reason?: string;
  durationMs: number;
}

/**
 * Best-effort probe: spawn the MCP command with stdio piped through and look
 * for "alive after N ms" as success — MCP servers are stdio JSON-RPC daemons,
 * so they don't exit on their own. An immediate non-zero exit (e.g. package
 * not found) is reported as the failure reason. Timeout defaults to 4s to
 * keep the Settings probe responsive while still tolerating a first-time
 * `npx -y <pkg>` cold download.
 */
export function probeServer(s: McpServerConfig, timeoutMs = 4000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (r: ProbeResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(s.command, s.args, {
        env: { ...process.env, ...(s.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish({ ok: false, reason: err instanceof Error ? err.message : 'spawn failed', durationMs: 0 });
      return;
    }

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8').slice(0, 256);
    });

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      finish({ ok: true, durationMs: Date.now() - started });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, reason: err.message, durationMs: Date.now() - started });
    });
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal === 'SIGTERM') return; // we ended it after the success window
      if (code === 0) finish({ ok: true, durationMs: Date.now() - started });
      else
        finish({
          ok: false,
          reason: stderr.trim() || `exited ${code}`,
          durationMs: Date.now() - started,
        });
    });
  });
}
