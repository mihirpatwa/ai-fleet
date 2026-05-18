import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/install-hooks.ts', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

function run(env: NodeJS.ProcessEnv, args: string[] = []): string {
  return execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('install-hooks', () => {
  it('merges idempotently, preserving unrelated settings and foreign hooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aifleet-hooks-'));
    const path = join(dir, 'settings.json');
    try {
      writeFileSync(
        path,
        JSON.stringify({
          model: 'opusish',
          permissions: { allow: ['Bash(*)'] },
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo foreign' }] },
            ],
          },
        }),
      );

      run({ CLAUDE_SETTINGS_PATH: path, AIFLEET_PORT: '7878' });
      run({ CLAUDE_SETTINGS_PATH: path, AIFLEET_PORT: '7878' }); // second run = idempotent

      const s = JSON.parse(readFileSync(path, 'utf8'));
      expect(s.model).toBe('opusish'); // unrelated key preserved
      expect(s.permissions.allow).toEqual(['Bash(*)']);

      const isOurs = (m: { hooks: Array<{ command: string }> }): boolean =>
        m.hooks.some((h) => h.command.includes('aifleet:event-hook'));

      // Foreign PreToolUse hook survived; exactly one ai-fleet entry added.
      expect(
        s.hooks.PreToolUse.some((m: { hooks: [{ command: string }] }) =>
          m.hooks[0].command.includes('echo foreign'),
        ),
      ).toBe(true);
      for (const evt of ['PreToolUse', 'PostToolUse', 'Stop']) {
        expect(s.hooks[evt].filter(isOurs)).toHaveLength(1);
      }
      // The command targets the configured port and reads the task id from env.
      const stop = s.hooks.Stop.find(isOurs);
      expect(stop.hooks[0].command).toContain('localhost:7878/events');
      expect(stop.hooks[0].command).toContain('AIFLEET_TASK_ID');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--print does not write the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aifleet-hooks-'));
    const path = join(dir, 'settings.json');
    try {
      const out = run({ CLAUDE_SETTINGS_PATH: path }, ['--print']);
      expect(existsSync(path)).toBe(false);
      expect(JSON.parse(out).hooks.PostToolUse).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
