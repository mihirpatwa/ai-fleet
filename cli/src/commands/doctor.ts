import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { execa } from 'execa';
import { paths } from '../lib/paths.js';
import { getJson } from '../lib/http.js';
import { isOnline } from '../lib/pm2.js';

interface Result {
  ok: boolean;
  detail: string;
}
type Check = { name: string; run: () => Promise<Result> };

function canWrite(p: string): boolean {
  try {
    accessSync(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const checks: Check[] = [
  {
    name: 'Claude credentials',
    run: async () => {
      if (process.env['ANTHROPIC_API_KEY']) return { ok: true, detail: 'ANTHROPIC_API_KEY set' };
      const candidates = [
        join(homedir(), '.claude', '.credentials.json'),
        join(homedir(), '.claude.json'),
        join(homedir(), '.config', 'claude', '.credentials.json'),
      ];
      const hit = candidates.find((c) => existsSync(c));
      return hit
        ? { ok: true, detail: `Claude Code logged in (${hit})` }
        : { ok: false, detail: 'no ANTHROPIC_API_KEY and no Claude Code credentials file' };
    },
  },
  {
    name: 'claude --version',
    run: async () => {
      const res = await execa('claude', ['--version'], { reject: false });
      return res.exitCode === 0
        ? { ok: true, detail: res.stdout.trim() }
        : { ok: false, detail: res.stderr.trim() || 'claude CLI not found on PATH' };
    },
  },
  {
    name: 'global agent symlinks',
    run: async () => {
      if (!existsSync(paths.claudeAgentsDir)) {
        return {
          ok: false,
          detail: `${paths.claudeAgentsDir} missing — run scripts/link-agents.sh`,
        };
      }
      const expected = readdirSync(paths.agentsDir).filter((f) => f.endsWith('.md'));
      const missing: string[] = [];
      for (const f of expected) {
        const link = join(paths.claudeAgentsDir, f);
        try {
          if (realpathSync(link) !== realpathSync(join(paths.agentsDir, f))) missing.push(f);
        } catch {
          missing.push(f);
        }
      }
      return missing.length === 0
        ? { ok: true, detail: `${expected.length} agents linked` }
        : { ok: false, detail: `not linked: ${missing.join(', ')}` };
    },
  },
  {
    name: 'state.db writable',
    run: async () => {
      if (existsSync(paths.stateDb)) {
        return canWrite(paths.stateDb)
          ? { ok: true, detail: paths.stateDb }
          : { ok: false, detail: `${paths.stateDb} not writable` };
      }
      const parent = existsSync(paths.aifleetHome) ? paths.aifleetHome : dirname(paths.aifleetHome);
      return canWrite(parent)
        ? { ok: true, detail: 'absent — will be created on `ai-fleet up`' }
        : { ok: false, detail: `cannot create ${paths.stateDb} (${parent} not writable)` };
    },
  },
  {
    name: 'daemon /healthz',
    run: async () => {
      const expected = await isOnline('aifleet-daemon');
      if (!expected) return { ok: true, detail: 'daemon not started (run `ai-fleet up`)' };
      try {
        const h = await getJson<{ ok?: boolean }>('/healthz');
        return h.ok === true
          ? { ok: true, detail: 'reachable' }
          : { ok: false, detail: 'unhealthy response' };
      } catch {
        return { ok: false, detail: 'pm2 reports online but /healthz unreachable' };
      }
    },
  },
  {
    name: 'Claude hooks installed',
    run: async () => {
      if (!existsSync(paths.claudeSettings)) {
        return { ok: false, detail: `${paths.claudeSettings} missing` };
      }
      try {
        const s = readFileSync(paths.claudeSettings, 'utf8');
        return s.includes('aifleet:event-hook')
          ? { ok: true, detail: 'PreToolUse/PostToolUse/Stop hooks present' }
          : { ok: false, detail: 'hooks not found — run scripts/install-hooks.ts' };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  },
];

export async function doctor(): Promise<void> {
  let failed = 0;
  for (const c of checks) {
    const r = await c.run().catch((e: unknown) => ({
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }));
    if (!r.ok) failed++;
    const tag = r.ok ? pc.green('PASS') : pc.red('FAIL');
    console.log(`${tag}  ${c.name.padEnd(24)}  ${pc.dim(r.detail)}`);
  }
  if (failed > 0) {
    console.log(pc.red(`\n${failed} check(s) failed`));
    process.exitCode = 1;
  } else {
    console.log(pc.green('\nall checks passed'));
  }
}
