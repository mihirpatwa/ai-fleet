// Cron scheduler. Evaluates scheduled_tasks every minute (UTC) and
// materializes a normal task from each due row. Self-contained 5-field cron
// (min hour dom mon dow) — no dependency.
import { ulid } from 'ulid';
import type { Logger } from 'pino';
import { aifleetDir } from './config.js';
import type { FleetDb, Json } from './db.js';
import { nowTs } from './time.js';

function parseField(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Math.max(1, parseInt(stepRaw, 10)) : 1;
    let lo = min;
    let hi = max;
    if (range && range !== '*') {
      const [a, b] = range.split('-');
      lo = parseInt(a as string, 10);
      hi = b !== undefined ? parseInt(b, 10) : lo;
    }
    for (let v = lo; v <= hi; v++) {
      if ((v - lo) % step === 0 && v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

interface Cron {
  mi: Set<number>;
  ho: Set<number>;
  dom: Set<number>;
  mon: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`invalid cron (need 5 fields): "${expr}"`);
  const [mi, ho, dom, mon, dowRaw] = f as [string, string, string, string, string];
  const dow = parseField(dowRaw, 0, 7);
  if (dow.has(7)) dow.add(0); // 7 and 0 are both Sunday
  return {
    mi: parseField(mi, 0, 59),
    ho: parseField(ho, 0, 23),
    dom: parseField(dom, 1, 31),
    mon: parseField(mon, 1, 12),
    dow,
    domRestricted: dom !== '*',
    dowRestricted: dowRaw !== '*',
  };
}

export function matchesCron(expr: string, d: Date): boolean {
  const c = parseCron(expr);
  if (!c.mi.has(d.getUTCMinutes())) return false;
  if (!c.ho.has(d.getUTCHours())) return false;
  if (!c.mon.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.has(d.getUTCDate());
  const dowOk = c.dow.has(d.getUTCDay());
  // Vixie rule: if both day-of-month and day-of-week are restricted, either
  // may match; otherwise the unrestricted one is a wildcard and both apply.
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/** First UTC minute strictly after `from` that matches, as `YYYY-MM-DD HH:MM:SS`. */
export function nextRun(expr: string, from: Date = new Date()): string | null {
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchesCron(expr, d)) return nowTs(d);
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

/** s3: list the next N runs (UTC) after `from`. Returns [] for invalid crons. */
export function previewRuns(expr: string, count = 3, from: Date = new Date()): string[] {
  try {
    parseCron(expr);
  } catch {
    return [];
  }
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const ts = nextRun(expr, cursor);
    if (!ts) break;
    out.push(ts);
    cursor = new Date(ts.replace(' ', 'T') + 'Z');
  }
  return out;
}

interface SeedDef {
  name: string;
  cron: string;
  agent: string;
  input: Json;
}
const DEFAULTS: SeedDef[] = [
  { name: 'scribe-daily', cron: '5 0 * * *', agent: 'scribe', input: { job: 'daily-summary' } },
  {
    name: 'memory-compact-weekly',
    cron: '0 3 * * 0',
    agent: 'scribe',
    input: { job: 'memory-compact' },
  },
  {
    name: 'deps-audit-daily',
    cron: '0 6 * * *',
    agent: 'security-auditor',
    input: { job: 'deps-audit', changed_paths: [] },
  },
];

/* ---------------------------- r5 CRUD ---------------------------- */

export interface ScheduledRow {
  id: string;
  name: string;
  cron: string;
  agent: string;
  input_json: Json;
  project_root: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  enabled: boolean;
}

function rowFromDb(r: Record<string, unknown>): ScheduledRow {
  let input: Json = {};
  try {
    input = r['input_json'] ? (JSON.parse(String(r['input_json'])) as Json) : {};
  } catch {
    /* ignore */
  }
  return {
    id: String(r['id']),
    name: String(r['name']),
    cron: String(r['cron']),
    agent: String(r['agent']),
    input_json: input,
    project_root: (r['project_root'] as string) ?? null,
    last_run_at: (r['last_run_at'] as string) ?? null,
    next_run_at: (r['next_run_at'] as string) ?? null,
    enabled: Number(r['enabled']) === 1,
  };
}

export function listScheduled(db: FleetDb): ScheduledRow[] {
  const rows = db.raw
    .prepare(
      `SELECT id, name, cron, agent, input_json, project_root,
              last_run_at, next_run_at, enabled
         FROM scheduled_tasks
         ORDER BY name ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowFromDb);
}

export interface ScheduledInput {
  name: string;
  cron: string;
  agent: string;
  project_root?: string | null;
  input_json?: Json;
  enabled?: boolean;
}

export function createScheduled(db: FleetDb, input: ScheduledInput): ScheduledRow {
  // Validate cron up front — better a 400 than a row we'd disable later.
  parseCron(input.cron);
  const id = ulid();
  const next = nextRun(input.cron);
  db.raw
    .prepare(
      `INSERT INTO scheduled_tasks (id, name, cron, agent, input_json, project_root, next_run_at, enabled)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.name,
      input.cron,
      input.agent,
      JSON.stringify(input.input_json ?? {}),
      input.project_root ?? null,
      next,
      input.enabled === false ? 0 : 1,
    );
  return one(db, id);
}

export interface ScheduledPatch {
  name?: string;
  cron?: string;
  agent?: string;
  project_root?: string | null;
  input_json?: Json;
  enabled?: boolean;
}

export function updateScheduled(
  db: FleetDb,
  id: string,
  patch: ScheduledPatch,
): ScheduledRow | null {
  const existing = oneOrNull(db, id);
  if (!existing) return null;
  if (patch.cron !== undefined) parseCron(patch.cron);
  const fields: string[] = [];
  const args: unknown[] = [];
  const setField = (col: string, v: unknown): void => {
    fields.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.name !== undefined) setField('name', patch.name);
  if (patch.cron !== undefined) {
    setField('cron', patch.cron);
    setField('next_run_at', nextRun(patch.cron));
  }
  if (patch.agent !== undefined) setField('agent', patch.agent);
  if (patch.project_root !== undefined) setField('project_root', patch.project_root);
  if (patch.input_json !== undefined) setField('input_json', JSON.stringify(patch.input_json));
  if (patch.enabled !== undefined) setField('enabled', patch.enabled ? 1 : 0);
  if (fields.length === 0) return existing;
  args.push(id);
  db.raw.prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return one(db, id);
}

export function deleteScheduled(db: FleetDb, id: string): boolean {
  const r = db.raw.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  return r.changes > 0;
}

/** s2: materialize a task from a scheduled row right now, without touching
 *  the cron. last_run_at is bumped so the row's history reflects the
 *  manual fire. Returns the new task id. */
export function runScheduledNow(
  db: FleetDb,
  id: string,
): { task_id: string } | null {
  const row = oneOrNull(db, id);
  if (!row) return null;
  const task = db.createTask({
    projectRoot: row.project_root || aifleetDir(),
    title: `scheduled (manual): ${row.name}`,
    assignedAgent: row.agent,
    inputJson: row.input_json,
  });
  db.raw.prepare('UPDATE scheduled_tasks SET last_run_at = ? WHERE id = ?').run(nowTs(), id);
  return { task_id: task.id };
}

function one(db: FleetDb, id: string): ScheduledRow {
  const row = oneOrNull(db, id);
  if (!row) throw new Error(`scheduled_tasks row ${id} missing after upsert`);
  return row;
}
function oneOrNull(db: FleetDb, id: string): ScheduledRow | null {
  const r = db.raw
    .prepare(
      `SELECT id, name, cron, agent, input_json, project_root,
              last_run_at, next_run_at, enabled
         FROM scheduled_tasks WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return r ? rowFromDb(r) : null;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Evaluate due rows now (exposed for tests). Returns # tasks materialized. */
  tick(at?: Date): number;
}

export function createScheduler(deps: { db: FleetDb; logger: Logger }): Scheduler {
  const { db, logger } = deps;
  let timer: NodeJS.Timeout | null = null;

  function seedDefaults(): void {
    const { c } = db.raw.prepare('SELECT COUNT(*) AS c FROM scheduled_tasks').get() as {
      c: number;
    };
    if (c > 0) return;
    const ins = db.raw.prepare(
      `INSERT INTO scheduled_tasks (id, name, cron, agent, input_json, project_root, next_run_at, enabled)
       VALUES (?,?,?,?,?,NULL,?,1)`,
    );
    for (const d of DEFAULTS) {
      ins.run(ulid(), d.name, d.cron, d.agent, JSON.stringify(d.input), nextRun(d.cron));
    }
    logger.info({ seeded: DEFAULTS.map((d) => d.name) }, 'seeded default scheduled tasks');
  }

  function tick(at: Date = new Date()): number {
    const now = nowTs(at);
    const rows = db.raw
      .prepare(
        `SELECT id, name, cron, agent, input_json AS input, project_root AS projectRoot
         FROM scheduled_tasks
         WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`,
      )
      .all(now) as Array<{
      id: string;
      name: string;
      cron: string;
      agent: string;
      input: string | null;
      projectRoot: string | null;
    }>;
    let made = 0;
    for (const r of rows) {
      let next: string | null;
      try {
        next = nextRun(r.cron, at);
      } catch (err) {
        db.raw.prepare('UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?').run(r.id);
        logger.error({ name: r.name, err }, 'disabled scheduled task with invalid cron');
        continue;
      }
      try {
        const input = r.input ? (JSON.parse(r.input) as Json) : {};
        db.createTask({
          projectRoot: r.projectRoot || aifleetDir(),
          title: `scheduled: ${r.name}`,
          assignedAgent: r.agent,
          inputJson: input,
        });
        db.raw
          .prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?')
          .run(now, next, r.id);
        made++;
        logger.info({ name: r.name, agent: r.agent, nextRunAt: next }, 'scheduled task fired');
      } catch (err) {
        logger.error({ name: r.name, err }, 'failed to materialize scheduled task');
      }
    }
    return made;
  }

  return {
    start() {
      seedDefaults();
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          logger.error({ err }, 'scheduler tick failed');
        }
      }, 60_000);
      timer.unref();
      logger.info('scheduler started (60s cadence)');
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}
