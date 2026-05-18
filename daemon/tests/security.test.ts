import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type FleetDb } from '../src/db.js';
import { unresolvedSecurityBlock } from '../src/security.js';

let db: FleetDb;
beforeEach(() => {
  db = createDb({ path: ':memory:' });
});
afterEach(() => db.close());

function root(): string {
  return db.createTask({ projectRoot: '/p', title: 'goal', assignedAgent: 'orchestrator' }).id;
}
function audit(rootId: string, out: unknown, status: 'done' | 'failed' = 'done'): void {
  const t = db.createTask({
    projectRoot: '/p',
    title: 'audit',
    assignedAgent: 'security-auditor',
    parentId: rootId,
  });
  db.updateTask(t.id, { status, ...(out !== undefined ? { outputJson: out as never } : {}) });
}

describe('pre-completion security gate', () => {
  it('does not block when the tree was never audited', () => {
    expect(unresolvedSecurityBlock(db, root()).blocked).toBe(false);
  });

  it('blocks on a blocking auditor result', () => {
    const r = root();
    audit(r, { blocking: true, findings: [{ severity: 'high' }] });
    expect(unresolvedSecurityBlock(db, r).blocked).toBe(true);
  });

  it('clears once a later audit passes', () => {
    const r = root();
    audit(r, { blocking: true, findings: [{ severity: 'critical' }] });
    audit(r, { blocking: false, findings: [] });
    expect(unresolvedSecurityBlock(db, r).blocked).toBe(false);
  });

  it('blocks when the latest auditor task is not done', () => {
    const r = root();
    audit(r, undefined, 'failed');
    const g = unresolvedSecurityBlock(db, r);
    expect(g.blocked).toBe(true);
    expect(g.reason).toMatch(/not done/);
  });

  it('blocks on an unresolved high|critical even without the blocking flag', () => {
    const r = root();
    audit(r, { findings: [{ severity: 'critical' }] });
    expect(unresolvedSecurityBlock(db, r).blocked).toBe(true);
  });
});
