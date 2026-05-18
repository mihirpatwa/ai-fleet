// Adaptive memory — the store behind the MCP server, the CLI, the dashboard
// and the hot tier. Operates on FleetDb.raw (FTS5 + the memories table from
// migration 002). Hybrid retrieval: FTS bm25 + tag overlap + confidence/use.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { tsMsAgo, type FleetDb } from './db.js';
import { nowTs } from './time.js';

export interface Memory {
  id: string;
  projectRoot: string;
  agent: string | null;
  tags: string[];
  context: string | null;
  lesson: unknown; // {when,do,avoid,why}
  confidence: number;
  usedCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  pinned: boolean;
}

export interface MemoryInput {
  projectRoot: string;
  agent?: string | null;
  tags?: string[];
  context?: string;
  lesson: unknown;
  confidence?: number;
}

type Row = Record<string, unknown>;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function mapMemory(r: Row): Memory {
  const parse = (v: unknown, fb: unknown): unknown => {
    if (v == null) return fb;
    try {
      return JSON.parse(String(v));
    } catch {
      return fb;
    }
  };
  return {
    id: String(r['id']),
    projectRoot: String(r['project_root']),
    agent: (r['agent'] as string) ?? null,
    tags: (parse(r['tags'], []) as string[]) ?? [],
    context: (r['context'] as string) ?? null,
    lesson: parse(r['lesson_json'], null),
    confidence: Number(r['confidence'] ?? 0),
    usedCount: Number(r['used_count'] ?? 0),
    lastUsedAt: (r['last_used_at'] as string) ?? null,
    createdAt: String(r['created_at']),
    pinned: Number(r['pinned'] ?? 0) === 1,
  };
}

const COLS = `id, project_root, agent, tags, context, lesson_json, confidence,
  used_count, last_used_at, created_at, pinned`;

/** Terminal retrospector runs recorded for a project (drives shadow mode). */
export function completedRetrospectorRuns(db: FleetDb, projectRoot: string): number {
  const r = db.raw
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks
       WHERE assigned_agent='retrospector' AND project_root=?
         AND status IN ('done','failed','blocked','cancelled')`,
    )
    .get(projectRoot) as { c: number };
  return Number(r.c ?? 0);
}

export function addMemory(
  db: FleetDb,
  input: MemoryInput,
  opts: { shadow?: boolean } = {},
): { id: string } {
  const id = ulid();
  const confidence = opts.shadow
    ? 0.3
    : clamp01(typeof input.confidence === 'number' ? input.confidence : 0.5);
  db.raw
    .prepare(
      `INSERT INTO memories (id, project_root, agent, tags, context, lesson_json, confidence)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.projectRoot,
      input.agent ?? null,
      JSON.stringify(input.tags ?? []),
      input.context ?? null,
      JSON.stringify(input.lesson ?? null),
      confidence,
    );
  return { id };
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a.map((s) => s.toLowerCase()));
  const B = new Set(b.map((s) => s.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function ftsMatch(query: string): string | null {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  return [...new Set(tokens)].map((t) => `"${t}"`).join(' OR ');
}

export interface SearchOpts {
  query?: string;
  tags?: string[];
  agent?: string;
  projectRoot?: string;
  topK?: number;
}

/** Hybrid retrieval. Touches used_count/last_used_at on returned rows. */
export function searchMemories(db: FleetDb, opts: SearchOpts, touch = true): Memory[] {
  const topK = opts.topK ?? 5;
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.projectRoot) {
    where.push('m.project_root = ?');
    args.push(opts.projectRoot);
  }
  if (opts.agent) {
    where.push('(m.agent = ? OR m.agent IS NULL)');
    args.push(opts.agent);
  }

  const match = opts.query ? ftsMatch(opts.query) : null;
  let rows: Array<Row & { bm25?: number }>;
  if (match) {
    rows = db.raw
      .prepare(
        `SELECT ${COLS.split(',')
          .map((c) => `m.${c.trim()}`)
          .join(', ')}, bm25(memories_fts) AS bm25
         FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ? ${where.length ? 'AND ' + where.join(' AND ') : ''}
         ORDER BY bm25(memories_fts) LIMIT 200`,
      )
      .all(match, ...args) as Array<Row & { bm25?: number }>;
  } else {
    rows = db.raw
      .prepare(
        `SELECT ${COLS} FROM memories m ${
          where.length ? 'WHERE ' + where.join(' AND ') : ''
        } ORDER BY confidence DESC, datetime(created_at) DESC LIMIT 200`,
      )
      .all(...args) as Row[];
  }
  if (rows.length === 0) return [];

  // Normalize bm25 (lower is better) → ftsScore in [0,1] across the candidate set.
  const bms = rows.map((r) => (typeof r.bm25 === 'number' ? r.bm25 : 0));
  const min = Math.min(...bms);
  const max = Math.max(...bms);
  const span = max - min || 1;

  const scored = rows.map((r, i) => {
    const m = mapMemory(r);
    const ftsScore = match ? 1 - ((bms[i] as number) - min) / span : 0;
    const tagOverlap = opts.tags && opts.tags.length ? jaccard(opts.tags, m.tags) : 0;
    const useTerm = m.confidence * Math.log1p(m.usedCount);
    const score = 0.6 * ftsScore + 0.3 * tagOverlap + 0.1 * useTerm;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).map((s) => s.m);

  if (touch && top.length) {
    const ids = top.map((m) => m.id);
    db.raw
      .prepare(
        `UPDATE memories SET used_count = used_count + 1, last_used_at = ?
         WHERE id IN (${ids.map(() => '?').join(',')})`,
      )
      .run(nowTs(), ...ids);
    for (const m of top) {
      m.usedCount += 1;
      m.lastUsedAt = nowTs();
    }
  }
  return top;
}

export function listMemories(
  db: FleetDb,
  opts: { projectRoot?: string; agent?: string; limit?: number } = {},
): Memory[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.projectRoot) {
    where.push('project_root = ?');
    args.push(opts.projectRoot);
  }
  if (opts.agent) {
    where.push('agent = ?');
    args.push(opts.agent);
  }
  const rows = db.raw
    .prepare(
      `SELECT ${COLS} FROM memories ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY confidence DESC, datetime(created_at) DESC LIMIT ?`,
    )
    .all(...args, opts.limit ?? 20) as Row[];
  return rows.map(mapMemory);
}

export function getMemory(db: FleetDb, id: string): Memory | null {
  const r = db.raw.prepare(`SELECT ${COLS} FROM memories WHERE id = ?`).get(id) as Row | undefined;
  return r ? mapMemory(r) : null;
}

export function pinMemory(db: FleetDb, id: string, pinned: boolean): void {
  db.raw.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
}

export function updateLesson(db: FleetDb, id: string, lesson: unknown): void {
  db.raw
    .prepare('UPDATE memories SET lesson_json = ? WHERE id = ?')
    .run(JSON.stringify(lesson), id);
}

export function deleteMemory(db: FleetDb, id: string): void {
  db.raw.prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export function exportMemories(db: FleetDb, projectRoot?: string): Memory[] {
  const rows = db.raw
    .prepare(
      `SELECT ${COLS} FROM memories ${projectRoot ? 'WHERE project_root = ?' : ''}
       ORDER BY datetime(created_at)`,
    )
    .all(...(projectRoot ? [projectRoot] : [])) as Row[];
  return rows.map(mapMemory);
}

/** Merge an export back in: existing id → keep max confidence + summed use. */
export function importMemories(db: FleetDb, items: Memory[]): { imported: number; merged: number } {
  let imported = 0;
  let merged = 0;
  const tx = db.raw.transaction((list: Memory[]) => {
    for (const m of list) {
      const ex = db.raw.prepare('SELECT id FROM memories WHERE id = ?').get(m.id);
      if (ex) {
        db.raw
          .prepare(
            `UPDATE memories SET confidence = MAX(confidence, ?),
               used_count = used_count + ?, pinned = MAX(pinned, ?) WHERE id = ?`,
          )
          .run(m.confidence, m.usedCount, m.pinned ? 1 : 0, m.id);
        merged++;
      } else {
        db.raw
          .prepare(
            `INSERT INTO memories
               (id, project_root, agent, tags, context, lesson_json, confidence, used_count, pinned)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            m.id,
            m.projectRoot,
            m.agent,
            JSON.stringify(m.tags),
            m.context,
            JSON.stringify(m.lesson),
            m.confidence,
            m.usedCount,
            m.pinned ? 1 : 0,
          );
        imported++;
      }
    }
  });
  tx(items);
  return { imported, merged };
}

/* ------------------------------ hygiene -------------------------------- */

export interface CompactResult {
  merged: number;
  decayed: number;
  pruned: number;
  projects: string[];
}

const MERGE_TAG_SIM = 0.7;
const MERGE_TEXT_SIM = 0.6;
const DECAY_DAYS = 14;

function textTokens(m: Memory): string[] {
  const blob = `${m.context ?? ''} ${JSON.stringify(m.lesson ?? '')}`.toLowerCase();
  return [...new Set(blob.match(/[a-z0-9]+/g) ?? [])];
}

export function compact(db: FleetDb): CompactResult {
  const all = db.raw
    .prepare(`SELECT ${COLS} FROM memories ORDER BY confidence DESC, datetime(created_at)`)
    .all() as Row[];
  const mems = all.map(mapMemory);
  let merged = 0;
  let decayed = 0;
  let pruned = 0;
  const projects = [...new Set(mems.map((m) => m.projectRoot))];
  const gone = new Set<string>();

  const tx = db.raw.transaction(() => {
    // merge near-duplicates (same agent, tag + text similarity)
    for (let i = 0; i < mems.length; i++) {
      const a = mems[i]!;
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < mems.length; j++) {
        const b = mems[j]!;
        if (gone.has(b.id) || a.agent !== b.agent) continue;
        if (
          jaccard(a.tags, b.tags) >= MERGE_TAG_SIM &&
          jaccard(textTokens(a), textTokens(b)) >= MERGE_TEXT_SIM
        ) {
          db.raw
            .prepare(
              `UPDATE memories SET confidence = MAX(?, ?), used_count = ?, tags = ?,
                 pinned = MAX(pinned, ?) WHERE id = ?`,
            )
            .run(
              a.confidence,
              b.confidence,
              a.usedCount + b.usedCount,
              JSON.stringify([...new Set([...a.tags, ...b.tags])]),
              b.pinned ? 1 : 0,
              a.id,
            );
          db.raw.prepare('DELETE FROM memories WHERE id = ?').run(b.id);
          gone.add(b.id);
          merged++;
        }
      }
    }
    // decay: -0.05 for lessons unused 14+ days
    const cutoff = tsMsAgo(DECAY_DAYS * 86_400_000);
    decayed = db.raw
      .prepare(
        `UPDATE memories SET confidence = MAX(0, confidence - 0.05)
         WHERE pinned = 0 AND COALESCE(last_used_at, created_at) < ?`,
      )
      .run(cutoff).changes;
    // prune weak, unused, unpinned
    pruned = db.raw
      .prepare('DELETE FROM memories WHERE confidence < 0.2 AND used_count = 0 AND pinned = 0')
      .run().changes;
  });
  tx();
  return { merged, decayed, pruned, projects };
}

/* ------------------------------ hot tier ------------------------------- */

const HOT_HEADING = '## Learned conventions';
const MAX_HOT_LINES = 200;

/** Top-5 lessons rendered as the hot-tier markdown section (pure). */
export function hotTierSection(memories: Memory[]): string {
  const ranked = [...memories]
    .sort(
      (a, b) =>
        b.confidence * Math.log1p(b.usedCount) - a.confidence * Math.log1p(a.usedCount) ||
        b.confidence - a.confidence,
    )
    .slice(0, 5);
  const lines = [HOT_HEADING, '', '<!-- regenerated by ai-fleet; edits here are overwritten -->'];
  for (const m of ranked) {
    const l = (m.lesson ?? {}) as { when?: string; do?: string; avoid?: string; why?: string };
    const when = l.when ?? m.context ?? 'general';
    const parts: string[] = [];
    if (l.do) parts.push(`do: ${l.do}`);
    if (l.avoid) parts.push(`avoid: ${l.avoid}`);
    if (l.why) parts.push(`why: ${l.why}`);
    lines.push(
      `- When ${when} — ${parts.join('; ') || 'see /memory'} ` + `_(${m.tags.join(', ')})_`,
    );
  }
  if (ranked.length === 0) lines.push('- (none yet)');
  return lines.slice(0, MAX_HOT_LINES).join('\n') + '\n';
}

function spliceSection(md: string, section: string): string {
  const headRe = new RegExp(`^${HOT_HEADING}\\s*$`, 'm');
  const m = headRe.exec(md);
  if (m) {
    const after = md.slice(m.index + m[0].length);
    const nextRe = /^#{1,2} /m;
    const nx = nextRe.exec(after);
    const tail = nx ? after.slice(nx.index) : '';
    return `${md.slice(0, m.index)}${section}\n${tail}`.replace(/\n{3,}/g, '\n\n');
  }
  // insert before "# User-authored" if present, else append
  const ua = /^# User-authored\s*$/m.exec(md);
  if (ua) return `${md.slice(0, ua.index)}${section}\n${md.slice(ua.index)}`;
  return `${md.trimEnd()}\n\n${section}`;
}

/**
 * Regenerate the hot-tier section in <projectRoot>/CLAUDE.md from the project's
 * top lessons. No-op while the project is still inside its shadow window
 * (shadowRemaining > 0) — lessons stay cold/visible-on-/memory but unpromoted.
 */
export function regenerateHotTier(
  db: FleetDb,
  projectRoot: string,
  opts: { shadowRemaining?: number } = {},
): boolean {
  const claude = join(projectRoot, 'CLAUDE.md');
  if (!existsSync(claude)) return false;
  if ((opts.shadowRemaining ?? 0) > 0) return false; // shadow mode: don't promote
  const memories = listMemories(db, { projectRoot, limit: 50 });
  const section = hotTierSection(memories);
  try {
    writeFileSync(claude, spliceSection(readFileSync(claude, 'utf8'), section));
    return true;
  } catch {
    return false;
  }
}
