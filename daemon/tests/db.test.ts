import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ulid } from 'ulid';
import { createDb, type FleetDb } from '../src/db.js';

// Crockford base32, 26 chars, excludes I L O U.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function mem(): FleetDb {
  return createDb({ path: ':memory:' });
}

describe('db state layer', () => {
  it('runs migrations once and is idempotent (memory + file, fresh connection)', () => {
    const db = mem();
    expect(db.migrate().applied).toEqual([]); // createDb already applied them
    expect(
      (db.raw.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }).c,
    ).toBe(1);
    db.close();

    const file = join(tmpdir(), `aifleet-test-${ulid()}.db`);
    try {
      const d1 = createDb({ path: file });
      expect(d1.migrate().applied).toEqual([]);
      d1.close();
      const d2 = createDb({ path: file }); // new connection, same file
      expect(d2.migrate().applied).toEqual([]);
      expect(
        (d2.raw.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }).c,
      ).toBe(1);
      d2.close();
    } finally {
      for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
    }
  });

  it('generates ULID ids; root task points root_id at itself, child inherits it', () => {
    const db = mem();
    const root = db.createTask({ projectRoot: '/p', title: 'root', assignedAgent: 'planner' });
    expect(root.id).toMatch(ULID_RE);
    expect(root.rootId).toBe(root.id);
    expect(root.status).toBe('queued');
    const child = db.createTask({
      projectRoot: '/p',
      title: 'child',
      assignedAgent: 'coder',
      parentId: root.id,
    });
    expect(child.id).toMatch(ULID_RE);
    expect(child.rootId).toBe(root.id);
    db.close();
  });

  it('getReadyTasks respects depends_on', () => {
    const db = mem();
    const a = db.createTask({ projectRoot: '/p', title: 'A', assignedAgent: 'coder' });
    const b = db.createTask({
      projectRoot: '/p',
      title: 'B',
      assignedAgent: 'coder',
      dependsOn: [a.id],
    });
    const missingDep = db.createTask({
      projectRoot: '/p',
      title: 'M',
      assignedAgent: 'coder',
      dependsOn: ['NOT_A_REAL_ID'],
    });

    let ready = db.getReadyTasks().map((t) => t.id);
    expect(ready).toContain(a.id);
    expect(ready).not.toContain(b.id); // dep A not done
    expect(ready).not.toContain(missingDep.id); // dep missing

    db.updateTask(a.id, { status: 'done' });
    ready = db.getReadyTasks().map((t) => t.id);
    expect(ready).toContain(b.id); // dep satisfied
    expect(ready).not.toContain(a.id); // no longer queued
    db.close();
  });

  it('zod rejects malformed input', () => {
    const db = mem();
    // empty title
    expect(() =>
      db.createTask({ projectRoot: '/p', title: '', assignedAgent: 'coder' }),
    ).toThrow();
    // non-JSON value in input_json
    expect(() =>
      db.createTask({
        projectRoot: '/p',
        title: 'x',
        assignedAgent: 'coder',
        inputJson: (() => 1) as unknown as never,
      }),
    ).toThrow();
    // unknown key rejected by .strict()
    expect(() =>
      db.createTask({
        projectRoot: '/p',
        title: 'x',
        assignedAgent: 'coder',
        // @ts-expect-error intentional unknown key
        bogus: true,
      }),
    ).toThrow();
    db.close();
  });

  it('creates the expected indexes', () => {
    const db = mem();
    const names = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const idx of [
      'idx_tasks_status',
      'idx_tasks_project_status',
      'idx_tasks_assigned_agent',
      'idx_tasks_root_id',
      'idx_events_task_ts',
      'idx_agent_runs_started',
    ]) {
      expect(names).toContain(idx);
    }
    db.close();
  });

  it('records events and agent runs; costSince aggregates', () => {
    const db = mem();
    const t = db.createTask({ projectRoot: '/p', title: 'c', assignedAgent: 'coder' });
    const ev = db.recordEvent({
      taskId: t.id,
      agent: 'coder',
      type: 'started',
      payloadJson: { ok: true },
    });
    expect(ev.id).toBeGreaterThan(0);
    expect(db.listEvents({ taskId: t.id }).length).toBe(1);

    db.recordAgentRun({
      taskId: t.id,
      agent: 'coder',
      model: 'claude-sonnet-4-6',
      costUsd: 0.25,
      inputTokens: 100,
      outputTokens: 50,
      startedAt: '2000-01-01 00:00:00',
    });
    const c = db.costSince('1999-01-01 00:00:00');
    expect(c.runs).toBe(1);
    expect(c.totalUsd).toBeCloseTo(0.25);
    expect(c.inputTokens).toBe(100);
    db.close();
  });
});
