import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type FleetDb } from '../src/db.js';
import {
  addMemory,
  compact,
  completedRetrospectorRuns,
  deleteMemory,
  getMemory,
  hotTierSection,
  listMemories,
  regenerateHotTier,
  searchMemories,
} from '../src/memory.js';

let db: FleetDb;
beforeEach(() => {
  db = createDb({ path: ':memory:' });
});
afterEach(() => db.close());

const P = '/proj';

describe('memory store', () => {
  it('migration 002 created the FTS table + triggers', () => {
    const names = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toContain('memories');
    expect(names).toContain('memories_fts');
    for (const t of ['memories_ai', 'memories_ad', 'memories_au']) expect(names).toContain(t);
  });

  it('adds, full-text searches, and touches usage', () => {
    addMemory(db, {
      projectRoot: P,
      agent: 'coder',
      tags: ['react', 'forms', 'validation'],
      context: 'adding a form to this project',
      lesson: { do: 'zod schema in src/schemas', avoid: 'separate types' },
    });
    addMemory(db, {
      projectRoot: P,
      agent: 'coder',
      tags: ['routing'],
      context: 'adding a route',
      lesson: { do: 'use the router' },
    });

    const hit = searchMemories(db, { query: 'form validation schema', projectRoot: P });
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]?.context).toMatch(/form/);
    expect(hit[0]?.usedCount).toBe(1); // touched

    const byTag = searchMemories(db, { tags: ['validation'], projectRoot: P }, false);
    expect(byTag[0]?.tags).toContain('validation');
  });

  it('shadow mode pins confidence to 0.3', () => {
    const { id } = addMemory(
      db,
      { projectRoot: P, lesson: { do: 'x' }, confidence: 0.9 },
      { shadow: true },
    );
    expect(getMemory(db, id)?.confidence).toBe(0.3);
  });

  it('FTS index stays in sync on delete', () => {
    const { id } = addMemory(db, {
      projectRoot: P,
      context: 'uniquetoken_zzz appears here',
      lesson: {},
    });
    expect(searchMemories(db, { query: 'uniquetoken_zzz', projectRoot: P }, false).length).toBe(1);
    deleteMemory(db, id);
    expect(searchMemories(db, { query: 'uniquetoken_zzz', projectRoot: P }, false).length).toBe(0);
  });

  it('compact merges near-duplicates, decays stale, prunes weak', () => {
    addMemory(db, {
      projectRoot: P,
      agent: 'coder',
      tags: ['react', 'forms', 'validation'],
      context: 'forms use zod schemas in src schemas folder',
      lesson: { do: 'zod in src/schemas' },
      confidence: 0.6,
    });
    addMemory(db, {
      projectRoot: P,
      agent: 'coder',
      tags: ['react', 'forms', 'validation'],
      context: 'forms use zod schemas in the src schemas folder again',
      lesson: { do: 'zod in src/schemas' },
      confidence: 0.8,
    });
    // a stale, weak, unused lesson that should be pruned
    const weak = addMemory(db, { projectRoot: P, lesson: { do: 'meh' }, confidence: 0.21 });
    db.raw
      .prepare("UPDATE memories SET created_at='2000-01-01 00:00:00', last_used_at=NULL WHERE id=?")
      .run(weak.id);

    const r = compact(db);
    expect(r.merged).toBe(1);
    // The pair collapses to one row; compact keeps the higher-confidence one
    // (whichever id that is) and takes the max confidence.
    const dupSurvivors = listMemories(db, { projectRoot: P, agent: 'coder', limit: 50 }).filter(
      (m) => m.tags.includes('forms'),
    );
    expect(dupSurvivors).toHaveLength(1);
    expect(dupSurvivors[0]?.confidence).toBeCloseTo(0.8); // max kept
    expect(r.pruned).toBeGreaterThanOrEqual(1);
    expect(getMemory(db, weak.id)).toBeNull();
  });

  it('hotTierSection renders <=200 lines and ranks by confidence*log(use)', () => {
    const section = hotTierSection([
      {
        id: '1',
        projectRoot: P,
        agent: 'coder',
        tags: ['forms'],
        context: 'forms',
        lesson: {
          when: 'forms',
          do: 'zod in src/schemas',
          avoid: 'inline types',
          why: 'one source',
        },
        confidence: 0.9,
        usedCount: 5,
        lastUsedAt: null,
        createdAt: '2026-01-01 00:00:00',
        pinned: false,
      },
    ]);
    expect(section).toContain('## Learned conventions');
    expect(section).toContain('zod in src/schemas');
    expect(section.split('\n').length).toBeLessThanOrEqual(200);
  });

  it('regenerateHotTier respects the shadow window and preserves user content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aifleet-hot-'));
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# Guide\n\nbody\n\n# User-authored\n\nkeep me\n');
      addMemory(db, {
        projectRoot: dir,
        agent: 'coder',
        tags: ['forms'],
        context: 'forms',
        lesson: { do: 'zod in src/schemas' },
        confidence: 0.8,
      });
      // shadow window open → no promotion
      expect(regenerateHotTier(db, dir, { shadowRemaining: 5 })).toBe(false);
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).not.toContain('Learned conventions');
      // graduated → promote, preserving the user section
      expect(regenerateHotTier(db, dir, { shadowRemaining: 0 })).toBe(true);
      const md = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
      expect(md).toContain('## Learned conventions');
      expect(md).toContain('keep me');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts terminal retrospector runs for shadow gating', () => {
    expect(completedRetrospectorRuns(db, P)).toBe(0);
    const t = db.createTask({ projectRoot: P, title: 'r', assignedAgent: 'retrospector' });
    db.updateTask(t.id, { status: 'done' });
    expect(completedRetrospectorRuns(db, P)).toBe(1);
  });
});
