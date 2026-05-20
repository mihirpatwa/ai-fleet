// q6: MCP registry tests. Covers preset listing, custom upsert/delete, and
// the per-agent allowlist filter buildSdkMcpServers exposes to spawn.ts.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSdkMcpServers,
  deleteServer,
  listMergedServers,
  upsertServer,
} from '../src/mcp/registry.js';

let HOME: string;
let saved: string | undefined;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), 'aifleet-mcp-'));
  saved = process.env['AIFLEET_HOME'];
  process.env['AIFLEET_HOME'] = HOME;
});

afterEach(() => {
  if (saved === undefined) delete process.env['AIFLEET_HOME'];
  else process.env['AIFLEET_HOME'] = saved;
  try {
    rmSync(HOME, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('listMergedServers', () => {
  it('returns every preset disabled by default on a fresh install', () => {
    const all = listMergedServers();
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const s of all) {
      expect(s.preset).toBe(true);
      expect(s.enabled).toBe(false);
    }
  });

  it('reflects an enabled toggle on a preset', () => {
    const preset = listMergedServers().find((s) => s.name === 'chrome-devtools');
    expect(preset).toBeDefined();
    upsertServer({ ...preset!, enabled: true });
    const after = listMergedServers().find((s) => s.name === 'chrome-devtools');
    expect(after?.enabled).toBe(true);
    expect(after?.preset).toBe(true); // preset flag preserved
  });

  it('appends user-added custom servers after presets', () => {
    upsertServer({
      name: 'my-custom',
      command: 'npx',
      args: ['-y', 'example'],
      enabled: false,
    });
    const all = listMergedServers();
    const custom = all.find((s) => s.name === 'my-custom');
    expect(custom).toBeDefined();
    expect(custom?.preset).toBeUndefined();
  });

  it('delete removes the stored row but a preset rebounds to disabled state', () => {
    upsertServer({
      name: 'chrome-devtools',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      enabled: true,
    });
    deleteServer('chrome-devtools');
    const after = listMergedServers().find((s) => s.name === 'chrome-devtools');
    expect(after).toBeDefined();
    expect(after?.enabled).toBe(false);
  });
});

describe('buildSdkMcpServers', () => {
  beforeEach(() => {
    upsertServer({
      name: 'chrome-devtools',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      enabled: true,
      allowed_agents: ['tester'],
    });
    upsertServer({
      name: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      enabled: true,
    });
    upsertServer({
      name: 'postgres',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      enabled: false,
    });
  });

  it('returns only enabled servers when no agent is given', () => {
    const out = buildSdkMcpServers();
    expect(Object.keys(out).sort()).toEqual(['chrome-devtools', 'github']);
  });

  it('filters by allowlist when an agent is given', () => {
    const tester = buildSdkMcpServers('tester');
    expect(Object.keys(tester).sort()).toEqual(['chrome-devtools', 'github']);
    const coder = buildSdkMcpServers('coder');
    expect(Object.keys(coder).sort()).toEqual(['github']);
  });

  it('omits disabled servers regardless of agent', () => {
    const out = buildSdkMcpServers('coder');
    expect(out['postgres']).toBeUndefined();
  });
});
