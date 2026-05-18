import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { checkCostCaps } from '../src/costguard.js';
import { createDb, type FleetDb } from '../src/db.js';

let db: FleetDb;
const config = parseConfig({}); // per_task_cap_usd 1.0, per_agent_hourly_cap 0.5

beforeEach(() => {
  db = createDb({ path: ':memory:' });
});
afterEach(() => db.close());

function task(): string {
  return db.createTask({ projectRoot: '/p', title: 't', assignedAgent: 'coder' }).id;
}

describe('cost circuit breakers', () => {
  it('does not trip with no runs', () => {
    expect(checkCostCaps(db, config, task(), 'coder').exceeded).toBe(false);
  });

  it('trips the per-task absolute cap', () => {
    const id = task();
    db.recordAgentRun({ taskId: id, agent: 'coder', model: 'm', costUsd: 1.0 });
    const r = checkCostCaps(db, config, id, 'coder');
    expect(r.exceeded).toBe(true);
    expect(r.reason).toMatch(/per-task/);
  });

  it('trips the per-agent rolling-hour cap across tasks', () => {
    const a = task();
    const b = task();
    db.recordAgentRun({ taskId: a, agent: 'coder', model: 'm', costUsd: 0.3 });
    db.recordAgentRun({ taskId: b, agent: 'coder', model: 'm', costUsd: 0.3 });
    const r = checkCostCaps(db, config, b, 'coder');
    expect(r.exceeded).toBe(true);
    expect(r.reason).toMatch(/per-agent hourly/);
  });

  it('ignores runs older than one hour for the per-agent cap', () => {
    const id = task();
    // 0.6 would trip the per-agent hourly cap (>= 0.5) if counted, and stays
    // under the per-task absolute cap (1.0) — so a false result proves the
    // one-hour window excluded this old run.
    db.recordAgentRun({
      taskId: id,
      agent: 'coder',
      model: 'm',
      costUsd: 0.6,
      startedAt: '2000-01-01 00:00:00',
    });
    expect(checkCostCaps(db, config, id, 'coder').exceeded).toBe(false);
  });
});
