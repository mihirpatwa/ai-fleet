// s10: scheduler CRUD + previewRuns + runScheduledNow.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type FleetDb } from '../src/db.js';
import {
  createScheduled,
  deleteScheduled,
  listScheduled,
  previewRuns,
  runScheduledNow,
  updateScheduled,
} from '../src/scheduler.js';

let db: FleetDb;
beforeEach(() => {
  db = createDb({ path: ':memory:' });
});
afterEach(() => db.close());

describe('previewRuns', () => {
  it('returns N upcoming UTC fires for a valid cron', () => {
    const at = new Date(Date.UTC(2026, 0, 2, 12, 0));
    const next = previewRuns('0 6 * * *', 3, at);
    expect(next.length).toBe(3);
    // Each subsequent fire is strictly later than the previous.
    for (let i = 1; i < next.length; i++) expect(next[i]! > next[i - 1]!).toBe(true);
  });

  it('returns [] for invalid cron', () => {
    expect(previewRuns('not a cron', 3)).toEqual([]);
  });
});

describe('scheduled tasks CRUD', () => {
  it('creates, lists, updates and deletes a row', () => {
    const row = createScheduled(db, {
      name: 'test-job',
      cron: '0 12 * * *',
      agent: 'scribe',
    });
    expect(row.name).toBe('test-job');
    expect(row.enabled).toBe(true);
    expect(row.next_run_at).toMatch(/^\d{4}-\d{2}-\d{2} 12:00:00$/);

    let all = listScheduled(db);
    expect(all.find((r) => r.name === 'test-job')).toBeDefined();

    const updated = updateScheduled(db, row.id, { enabled: false, cron: '*/30 * * * *' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.cron).toBe('*/30 * * * *');

    expect(deleteScheduled(db, row.id)).toBe(true);
    all = listScheduled(db);
    expect(all.find((r) => r.name === 'test-job')).toBeUndefined();
  });

  it('rejects an invalid cron at create time', () => {
    expect(() =>
      createScheduled(db, { name: 'bad', cron: 'not a cron', agent: 'scribe' }),
    ).toThrow();
  });

  it('runScheduledNow materializes a task and stamps last_run_at', () => {
    const row = createScheduled(db, {
      name: 'manual',
      cron: '0 6 * * *',
      agent: 'scribe',
    });
    const out = runScheduledNow(db, row.id);
    expect(out).not.toBeNull();
    expect(out!.task_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const task = db.getTask(out!.task_id);
    expect(task?.title).toContain(row.name);
    const refreshed = listScheduled(db).find((r) => r.id === row.id);
    expect(refreshed?.last_run_at).toBeTruthy();
  });

  it('runScheduledNow on a missing id returns null', () => {
    expect(runScheduledNow(db, 'missing')).toBeNull();
  });
});
