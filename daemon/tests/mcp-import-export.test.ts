// s10: MCP export/import (q9). The functions touch ~/.aifleet via storage;
// each test uses a temp HOME so they don't leak across runs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exportServers,
  importServers,
  listMergedServers,
  upsertServer,
} from '../src/mcp/registry.js';

let HOME: string;
let saved: string | undefined;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), 'aifleet-mcp-io-'));
  saved = process.env['AIFLEET_HOME'];
  process.env['AIFLEET_HOME'] = HOME;
});

afterEach(() => {
  if (saved === undefined) delete process.env['AIFLEET_HOME'];
  else process.env['AIFLEET_HOME'] = saved;
  rmSync(HOME, { recursive: true, force: true });
});

describe('exportServers', () => {
  it('returns only stored rows, not preset defaults', () => {
    const out = exportServers();
    expect(out.servers).toEqual([]); // fresh install
    upsertServer({
      name: 'chrome-devtools',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      enabled: true,
    });
    expect(exportServers().servers.length).toBe(1);
  });
});

describe('importServers', () => {
  const payload = {
    servers: [
      {
        name: 'custom-one',
        command: 'npx',
        args: ['-y', 'pkg-a'],
        enabled: true,
      },
      {
        name: 'custom-two',
        command: 'npx',
        args: ['-y', 'pkg-b'],
        enabled: false,
      },
    ],
  };

  it('merges into the existing set by default', () => {
    upsertServer({
      name: 'preexisting',
      command: 'npx',
      args: ['-y', 'pre'],
      enabled: true,
    });
    const out = importServers(payload, 'merge');
    expect(out.count).toBe(2);
    const names = listMergedServers().map((s) => s.name);
    expect(names).toContain('preexisting');
    expect(names).toContain('custom-one');
    expect(names).toContain('custom-two');
  });

  it('replace mode wipes the stored set first', () => {
    upsertServer({
      name: 'will-be-deleted',
      command: 'npx',
      args: ['-y', 'gone'],
      enabled: true,
    });
    importServers(payload, 'replace');
    const stored = exportServers().servers.map((s) => s.name);
    expect(stored).toEqual(['custom-one', 'custom-two']);
  });

  it('throws on malformed input', () => {
    expect(() => importServers({ servers: 'not-an-array' }, 'merge')).toThrow();
    expect(() => importServers({}, 'merge')).toThrow();
    expect(() => importServers(null, 'merge')).toThrow();
  });

  it('drops malformed rows silently and counts only the good ones', () => {
    const mixed = {
      servers: [
        { name: 'ok', command: 'npx', args: [], enabled: true },
        { name: '', command: 'npx', args: [] }, // bad: no name
        { command: 'npx', args: [] }, // bad: no name
        { name: 'no-command', args: [] }, // bad: no command
      ],
    };
    const out = importServers(mixed, 'replace');
    expect(out.count).toBe(1);
    expect(exportServers().servers[0]?.name).toBe('ok');
  });
});
