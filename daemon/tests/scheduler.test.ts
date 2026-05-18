import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createDb, type FleetDb } from '../src/db.js';
import { createScheduler, matchesCron, nextRun, parseCron } from '../src/scheduler.js';

const silent = pino({ level: 'silent' });
let db: FleetDb;
beforeEach(() => {
  db = createDb({ path: ':memory:' });
});
afterEach(() => db.close());

const at = (y: number, mo: number, d: number, h: number, mi: number): Date =>
  new Date(Date.UTC(y, mo, d, h, mi));

describe('cron', () => {
  it('parses and matches the seeded expressions (UTC)', () => {
    expect(matchesCron('5 0 * * *', at(2026, 0, 2, 0, 5))).toBe(true);
    expect(matchesCron('5 0 * * *', at(2026, 0, 2, 0, 6))).toBe(false);
    // 2026-01-04 is a Sunday
    expect(at(2026, 0, 4, 3, 0).getUTCDay()).toBe(0);
    expect(matchesCron('0 3 * * 0', at(2026, 0, 4, 3, 0))).toBe(true);
    expect(matchesCron('0 3 * * 0', at(2026, 0, 5, 3, 0))).toBe(false); // Monday
    expect(matchesCron('0 6 * * *', at(2026, 0, 2, 6, 0))).toBe(true);
  });

  it('supports steps, lists and ranges', () => {
    expect(matchesCron('*/15 * * * *', at(2026, 0, 2, 9, 30))).toBe(true);
    expect(matchesCron('*/15 * * * *', at(2026, 0, 2, 9, 31))).toBe(false);
    expect(matchesCron('0 9-17 * * 1-5', at(2026, 0, 2, 13, 0))).toBe(true); // Fri 13:00
    expect(matchesCron('0 9-17 * * 1-5', at(2026, 0, 4, 13, 0))).toBe(false); // Sun
    expect(() => parseCron('only four fields here')).toThrow();
  });

  it('nextRun returns the next matching UTC minute', () => {
    const next = nextRun('5 0 * * *', at(2026, 0, 2, 12, 0));
    expect(next).toBe('2026-01-03 00:05:00');
  });
});

describe('scheduler', () => {
  it('seeds the three default jobs exactly once', () => {
    const s = createScheduler({ db, logger: silent });
    s.start();
    s.stop();
    const rows = db.raw.prepare('SELECT name FROM scheduled_tasks ORDER BY name').all() as {
      name: string;
    }[];
    expect(rows.map((r) => r.name)).toEqual([
      'deps-audit-daily',
      'memory-compact-weekly',
      'scribe-daily',
    ]);
    // idempotent: a second start does not re-seed
    const s2 = createScheduler({ db, logger: silent });
    s2.start();
    s2.stop();
    expect(
      (db.raw.prepare('SELECT COUNT(*) AS c FROM scheduled_tasks').get() as { c: number }).c,
    ).toBe(3);
  });

  it('materializes a task when a row is due and reschedules it', () => {
    const s = createScheduler({ db, logger: silent });
    s.start();
    s.stop();
    db.raw
      .prepare(
        "UPDATE scheduled_tasks SET next_run_at='2000-01-01 00:00:00' WHERE name='scribe-daily'",
      )
      .run();
    const made = s.tick(new Date());
    expect(made).toBeGreaterThanOrEqual(1);
    const task = db.queryTasks({}).find((t) => t.title === 'scheduled: scribe-daily');
    expect(task?.assignedAgent).toBe('scribe');
    const row = db.raw
      .prepare("SELECT last_run_at, next_run_at FROM scheduled_tasks WHERE name='scribe-daily'")
      .get() as { last_run_at: string | null; next_run_at: string | null };
    expect(row.last_run_at).not.toBeNull();
    expect(row.next_run_at && row.next_run_at > '2000-01-01 00:00:00').toBe(true);
  });

  it('disables a row with an invalid cron instead of throwing', () => {
    const s = createScheduler({ db, logger: silent });
    db.raw
      .prepare(
        `INSERT INTO scheduled_tasks (id, name, cron, agent, input_json, next_run_at, enabled)
         VALUES ('x','bad','not a cron','scribe','{}',NULL,1)`,
      )
      .run();
    expect(() => s.tick(new Date())).not.toThrow();
    expect(
      (
        db.raw.prepare("SELECT enabled FROM scheduled_tasks WHERE name='bad'").get() as {
          enabled: number;
        }
      ).enabled,
    ).toBe(0);
  });
});
