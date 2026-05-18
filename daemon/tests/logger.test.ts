import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../src/logger.js';

describe('logger', () => {
  it('writes NDJSON to a dated file behind a stable daemon.log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aifleet-log-'));
    try {
      const { logger, logFile, close } = createLogger({ level: 'info', dir });
      expect(logFile).toBe(join(dir, 'daemon.log'));
      logger.info({ hello: 'world' }, 'smoke');
      await close();

      expect(existsSync(logFile)).toBe(true);
      const contents = readFileSync(realpathSync(logFile), 'utf8');
      const line = JSON.parse(contents.trim().split('\n')[0] as string);
      expect(line.msg).toBe('smoke');
      expect(line.hello).toBe('world');
      expect(line.svc).toBe('aifleet-daemon');
      expect(realpathSync(logFile)).toMatch(/daemon-\d{4}-\d{2}-\d{2}\.log$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
