import Database from 'better-sqlite3';
import { z } from 'zod';
import { ulid } from 'ulid';
import { homedir } from 'node:os';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Sqlite = Database.Database;

const HERE = dirname(fileURLToPath(import.meta.url));
// db.ts lives at daemon/{src,dist}; migrations/ is two levels up at the fleet root.
const MIGRATIONS_DIR = process.env['AIFLEET_MIGRATIONS_DIR'] ?? resolve(HERE, '../../migrations');

export function getDefaultDbPath(): string {
  return process.env['AIFLEET_DB_PATH'] ?? join(homedir(), '.aifleet', 'state.db');
}

/** UTC timestamp matching SQLite's CURRENT_TIMESTAMP format: `YYYY-MM-DD HH:MM:SS`. */
function nowTs(d: Date = new Date()): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
export function tsMsAgo(ms: number): string {
  return nowTs(new Date(Date.now() - ms));
}

/* ----------------------------- JSON ----------------------------- */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);
export type { Json };

/* ----------------------------- enums ---------------------------- */

export const TASK_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'blocked',
  'review',
  'cancelled',
] as const;
export const taskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatus>;

export const EVENT_TYPES = [
  'started',
  'tool_use_pre',
  'tool_use_post',
  'progress',
  'log',
  'completed',
  'failed',
  'blocked',
] as const;
export const eventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventType>;

/* ------------------------- input schemas ------------------------ */

export const createTaskInput = z
  .object({
    parentId: z.string().min(1).optional(),
    rootId: z.string().min(1).optional(),
    projectRoot: z.string().min(1),
    title: z.string().min(1),
    assignedAgent: z.string().min(1),
    status: taskStatus.default('queued'),
    dependsOn: z.array(z.string().min(1)).default([]),
    inputJson: jsonSchema.optional(),
    progress: z.number().int().min(0).max(100).default(0),
  })
  .strict();
export type CreateTaskInput = z.input<typeof createTaskInput>;

export const updateTaskInput = z
  .object({
    title: z.string().min(1).optional(),
    assignedAgent: z.string().min(1).optional(),
    status: taskStatus.optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
    inputJson: jsonSchema.optional(),
    outputJson: jsonSchema.optional(),
    progress: z.number().int().min(0).max(100).optional(),
    retryCount: z.number().int().min(0).optional(),
    error: z.string().nullable().optional(),
    startedAt: z.string().min(1).optional(),
    finishedAt: z.string().min(1).optional(),
  })
  .strict();
export type UpdateTaskInput = z.input<typeof updateTaskInput>;

export const recordEventInput = z
  .object({
    taskId: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    type: eventType,
    payloadJson: jsonSchema.optional(),
  })
  .strict();
export type RecordEventInput = z.input<typeof recordEventInput>;

export const recordAgentRunInput = z
  .object({
    taskId: z.string().min(1).optional(),
    agent: z.string().min(1),
    model: z.string().min(1),
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    cacheReadTokens: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
    status: z.string().min(1).optional(),
    startedAt: z.string().min(1).optional(),
    finishedAt: z.string().min(1).optional(),
  })
  .strict();
export type RecordAgentRunInput = z.input<typeof recordAgentRunInput>;

export const listEventsFilter = z
  .object({
    taskId: z.string().min(1).optional(),
    type: eventType.optional(),
    sinceId: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(10_000).default(200),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export type ListEventsFilter = z.input<typeof listEventsFilter>;

export const queryTasksFilter = z
  .object({
    status: taskStatus.optional(),
    agent: z.string().min(1).optional(),
    root: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(10_000).default(500),
  })
  .strict();
export type QueryTasksFilter = z.input<typeof queryTasksFilter>;

/* -------------------------- row schemas ------------------------- */

export const taskRow = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  rootId: z.string(),
  projectRoot: z.string(),
  title: z.string(),
  assignedAgent: z.string(),
  status: taskStatus,
  dependsOn: z.array(z.string()),
  inputJson: jsonSchema.nullable(),
  outputJson: jsonSchema.nullable(),
  progress: z.number(),
  retryCount: z.number(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Task = z.infer<typeof taskRow>;

export const eventRow = z.object({
  id: z.number(),
  taskId: z.string().nullable(),
  agent: z.string().nullable(),
  type: eventType,
  payloadJson: jsonSchema.nullable(),
  ts: z.string(),
});
export type FleetEvent = z.infer<typeof eventRow>;

export const agentRunRow = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  agent: z.string(),
  model: z.string(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  status: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type AgentRun = z.infer<typeof agentRunRow>;

export interface CostSummary {
  since: string;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  runs: number;
}
export interface CostBreakdownRow {
  key: string | null;
  runs: number;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/* ---------------------------- mapping --------------------------- */

const TASK_SELECT = `
  SELECT id,
         parent_id      AS parentId,
         root_id        AS rootId,
         project_root   AS projectRoot,
         title,
         assigned_agent AS assignedAgent,
         status,
         depends_on     AS dependsOn,
         input_json     AS inputJson,
         output_json    AS outputJson,
         progress,
         retry_count    AS retryCount,
         error,
         created_at     AS createdAt,
         updated_at     AS updatedAt,
         started_at     AS startedAt,
         finished_at    AS finishedAt
  FROM tasks`;

function parseJson(v: unknown): Json | null {
  if (v == null) return null;
  return JSON.parse(String(v)) as Json;
}

function mapTask(r: Record<string, unknown>): Task {
  return taskRow.parse({
    id: r['id'],
    parentId: r['parentId'] ?? null,
    rootId: r['rootId'],
    projectRoot: r['projectRoot'],
    title: r['title'],
    assignedAgent: r['assignedAgent'],
    status: r['status'],
    dependsOn: r['dependsOn'] == null ? [] : JSON.parse(String(r['dependsOn'])),
    inputJson: parseJson(r['inputJson']),
    outputJson: parseJson(r['outputJson']),
    progress: r['progress'],
    retryCount: r['retryCount'],
    error: r['error'] ?? null,
    createdAt: r['createdAt'],
    updatedAt: r['updatedAt'],
    startedAt: r['startedAt'] ?? null,
    finishedAt: r['finishedAt'] ?? null,
  });
}

function mapEvent(r: Record<string, unknown>): FleetEvent {
  return eventRow.parse({
    id: r['id'],
    taskId: r['taskId'] ?? null,
    agent: r['agent'] ?? null,
    type: r['type'],
    payloadJson: parseJson(r['payloadJson']),
    ts: r['ts'],
  });
}

/* -------------------------- migrations -------------------------- */

export interface MigrationResult {
  applied: string[];
}

function runMigrations(db: Sqlite): MigrationResult {
  const hasTable = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get() as { x: number } | undefined;
  const appliedSet = new Set<string>(
    hasTable
      ? (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
          (row) => row.version,
        )
      : [],
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  const applyOne = db.transaction((version: string, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      version,
      nowTs(),
    );
  });
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    applyOne(file, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    applied.push(file);
  }
  return { applied };
}

/* ----------------------------- api ------------------------------ */

export interface FleetDb {
  readonly raw: Sqlite;
  readonly path: string;
  migrate(): MigrationResult;
  resetSchema(): MigrationResult;
  close(): void;
  createTask(input: CreateTaskInput): Task;
  updateTask(id: string, patch: UpdateTaskInput): Task;
  getTask(id: string): Task | null;
  getTaskTree(rootId: string): Task[];
  getReadyTasks(limit?: number): Task[];
  queryTasks(filter?: QueryTasksFilter): Task[];
  recordEvent(input: RecordEventInput): FleetEvent;
  listEvents(filter?: ListEventsFilter): FleetEvent[];
  recordAgentRun(input: RecordAgentRunInput): AgentRun;
  costSince(timestamp: string): CostSummary;
  costBreakdown(opts: { since: string; by: 'agent' | 'task' | 'day' }): CostBreakdownRow[];
}

export function createDb(opts: { path?: string } = {}): FleetDb {
  const path = opts.path ?? getDefaultDbPath();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);

  const api: FleetDb = {
    raw: db,
    path,
    migrate: () => runMigrations(db),
    resetSchema: () => {
      db.pragma('foreign_keys = OFF');
      db.exec(
        `DROP TABLE IF EXISTS scheduled_tasks;
         DROP TABLE IF EXISTS memories_fts;
         DROP TABLE IF EXISTS memories;
         DROP TABLE IF EXISTS events;
         DROP TABLE IF EXISTS messages;
         DROP TABLE IF EXISTS agent_runs;
         DROP TABLE IF EXISTS tasks;
         DROP TABLE IF EXISTS schema_migrations;`,
      );
      db.pragma('foreign_keys = ON');
      return runMigrations(db);
    },
    close: () => db.close(),

    createTask: (input) => {
      const data = createTaskInput.parse(input);
      const id = ulid();
      let rootId = data.rootId;
      if (!rootId) {
        if (data.parentId) {
          const parent = api.getTask(data.parentId);
          if (!parent) throw new Error(`parent task not found: ${data.parentId}`);
          rootId = parent.rootId;
        } else {
          rootId = id;
        }
      }
      db.prepare(
        `INSERT INTO tasks
           (id, parent_id, root_id, project_root, title, assigned_agent, status, depends_on, input_json, progress)
         VALUES
           (@id, @parentId, @rootId, @projectRoot, @title, @assignedAgent, @status, @dependsOn, @inputJson, @progress)`,
      ).run({
        id,
        parentId: data.parentId ?? null,
        rootId,
        projectRoot: data.projectRoot,
        title: data.title,
        assignedAgent: data.assignedAgent,
        status: data.status,
        dependsOn: JSON.stringify(data.dependsOn),
        inputJson: data.inputJson === undefined ? null : JSON.stringify(data.inputJson),
        progress: data.progress,
      });
      const created = api.getTask(id);
      if (!created) throw new Error('createTask: row missing after insert');
      return created;
    },

    updateTask: (id, patch) => {
      const data = updateTaskInput.parse(patch);
      const current = api.getTask(id);
      if (!current) throw new Error(`task not found: ${id}`);
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      const put = (col: string, key: string, val: unknown): void => {
        sets.push(`${col} = @${key}`);
        params[key] = val;
      };
      if (data.title !== undefined) put('title', 'title', data.title);
      if (data.assignedAgent !== undefined)
        put('assigned_agent', 'assignedAgent', data.assignedAgent);
      if (data.dependsOn !== undefined)
        put('depends_on', 'dependsOn', JSON.stringify(data.dependsOn));
      if (data.inputJson !== undefined)
        put('input_json', 'inputJson', JSON.stringify(data.inputJson));
      if (data.outputJson !== undefined)
        put('output_json', 'outputJson', JSON.stringify(data.outputJson));
      if (data.progress !== undefined) put('progress', 'progress', data.progress);
      if (data.retryCount !== undefined) put('retry_count', 'retryCount', data.retryCount);
      if (data.error !== undefined) put('error', 'error', data.error);
      if (data.status !== undefined) {
        put('status', 'status', data.status);
        if (data.status === 'running' && !current.startedAt && data.startedAt === undefined) {
          put('started_at', 'autoStartedAt', nowTs());
        }
        const terminal: readonly TaskStatus[] = ['done', 'failed', 'blocked', 'cancelled'];
        if (
          terminal.includes(data.status) &&
          !current.finishedAt &&
          data.finishedAt === undefined
        ) {
          put('finished_at', 'autoFinishedAt', nowTs());
        }
      }
      if (data.startedAt !== undefined) put('started_at', 'startedAt', data.startedAt);
      if (data.finishedAt !== undefined) put('finished_at', 'finishedAt', data.finishedAt);
      put('updated_at', 'updatedAt', nowTs());
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
      const updated = api.getTask(id);
      if (!updated) throw new Error('updateTask: row missing after update');
      return updated;
    },

    getTask: (id) => {
      const r = db.prepare(`${TASK_SELECT} WHERE id = ?`).get(id) as
        | Record<string, unknown>
        | undefined;
      return r ? mapTask(r) : null;
    },

    getTaskTree: (rootId) => {
      const rows = db
        .prepare(`${TASK_SELECT} WHERE root_id = ? ORDER BY datetime(created_at) ASC, id ASC`)
        .all(rootId) as Record<string, unknown>[];
      return rows.map(mapTask);
    },

    getReadyTasks: (limit) => {
      const lim = z.number().int().min(1).max(10_000).default(50).parse(limit);
      // Wrap TASK_SELECT so the outer alias `t` disambiguates the correlated
      // depends_on from the joined `tasks dep` row (unqualified json_each here
      // otherwise binds to the inner join, never unblocking satisfied deps).
      const rows = db
        .prepare(
          `SELECT * FROM (${TASK_SELECT}) t
             WHERE t.status = 'queued'
               AND (
                 json_array_length(t.dependsOn) = 0
                 OR (SELECT COUNT(*) FROM json_each(t.dependsOn)) =
                    (SELECT COUNT(*) FROM json_each(t.dependsOn) je
                       JOIN tasks dep ON dep.id = je.value AND dep.status = 'done')
               )
             ORDER BY datetime(t.createdAt) ASC, t.id ASC
             LIMIT ?`,
        )
        .all(lim) as Record<string, unknown>[];
      return rows.map(mapTask);
    },

    queryTasks: (filter) => {
      const f = queryTasksFilter.parse(filter ?? {});
      const where: string[] = [];
      const args: unknown[] = [];
      if (f.status) {
        where.push('status = ?');
        args.push(f.status);
      }
      if (f.agent) {
        where.push('assigned_agent = ?');
        args.push(f.agent);
      }
      if (f.root) {
        where.push('root_id = ?');
        args.push(f.root);
      }
      if (f.project) {
        where.push('project_root = ?');
        args.push(f.project);
      }
      const sql = `${TASK_SELECT} ${
        where.length ? `WHERE ${where.join(' AND ')}` : ''
      } ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`;
      const rows = db.prepare(sql).all(...args, f.limit) as Record<string, unknown>[];
      return rows.map(mapTask);
    },

    recordEvent: (input) => {
      const data = recordEventInput.parse(input);
      const info = db
        .prepare(
          `INSERT INTO events (task_id, agent, type, payload_json)
           VALUES (@taskId, @agent, @type, @payloadJson)`,
        )
        .run({
          taskId: data.taskId ?? null,
          agent: data.agent ?? null,
          type: data.type,
          payloadJson: data.payloadJson === undefined ? null : JSON.stringify(data.payloadJson),
        });
      const row = db
        .prepare(
          `SELECT id, task_id AS taskId, agent, type, payload_json AS payloadJson, ts
             FROM events WHERE id = ?`,
        )
        .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
      return mapEvent(row);
    },

    listEvents: (filter) => {
      const f = listEventsFilter.parse(filter ?? {});
      const where: string[] = [];
      const args: unknown[] = [];
      if (f.taskId) {
        where.push('task_id = ?');
        args.push(f.taskId);
      }
      if (f.type) {
        where.push('type = ?');
        args.push(f.type);
      }
      if (f.sinceId !== undefined) {
        where.push('id > ?');
        args.push(f.sinceId);
      }
      const sql = `SELECT id, task_id AS taskId, agent, type, payload_json AS payloadJson, ts
                     FROM events
                     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                     ORDER BY id ${f.order === 'asc' ? 'ASC' : 'DESC'}
                     LIMIT ?`;
      const rows = db.prepare(sql).all(...args, f.limit) as Record<string, unknown>[];
      return rows.map(mapEvent);
    },

    recordAgentRun: (input) => {
      const data = recordAgentRunInput.parse(input);
      const id = ulid();
      const startedAt = data.startedAt ?? nowTs();
      db.prepare(
        `INSERT INTO agent_runs
           (id, task_id, agent, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, status, started_at, finished_at)
         VALUES
           (@id, @taskId, @agent, @model, @inputTokens, @outputTokens, @cacheReadTokens, @costUsd, @status, @startedAt, @finishedAt)`,
      ).run({
        id,
        taskId: data.taskId ?? null,
        agent: data.agent,
        model: data.model,
        inputTokens: data.inputTokens ?? null,
        outputTokens: data.outputTokens ?? null,
        cacheReadTokens: data.cacheReadTokens ?? null,
        costUsd: data.costUsd ?? null,
        status: data.status ?? null,
        startedAt,
        finishedAt: data.finishedAt ?? null,
      });
      const row = db
        .prepare(
          `SELECT id, task_id AS taskId, agent, model,
                  input_tokens AS inputTokens, output_tokens AS outputTokens,
                  cache_read_tokens AS cacheReadTokens, cost_usd AS costUsd,
                  status, started_at AS startedAt, finished_at AS finishedAt
             FROM agent_runs WHERE id = ?`,
        )
        .get(id) as Record<string, unknown>;
      return agentRunRow.parse({
        id: row['id'],
        taskId: row['taskId'] ?? null,
        agent: row['agent'],
        model: row['model'],
        inputTokens: row['inputTokens'] ?? null,
        outputTokens: row['outputTokens'] ?? null,
        cacheReadTokens: row['cacheReadTokens'] ?? null,
        costUsd: row['costUsd'] ?? null,
        status: row['status'] ?? null,
        startedAt: row['startedAt'] ?? null,
        finishedAt: row['finishedAt'] ?? null,
      });
    },

    costSince: (timestamp) => {
      const r = db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd),0)          AS totalUsd,
                  COALESCE(SUM(input_tokens),0)      AS inputTokens,
                  COALESCE(SUM(output_tokens),0)     AS outputTokens,
                  COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens,
                  COUNT(*)                           AS runs
             FROM agent_runs
            WHERE started_at >= ?`,
        )
        .get(timestamp) as Record<string, number>;
      return {
        since: timestamp,
        totalUsd: Number(r['totalUsd'] ?? 0),
        inputTokens: Number(r['inputTokens'] ?? 0),
        outputTokens: Number(r['outputTokens'] ?? 0),
        cacheReadTokens: Number(r['cacheReadTokens'] ?? 0),
        runs: Number(r['runs'] ?? 0),
      };
    },

    costBreakdown: ({ since, by }) => {
      const groupExpr = by === 'agent' ? 'agent' : by === 'task' ? 'task_id' : 'date(started_at)';
      const rows = db
        .prepare(
          `SELECT ${groupExpr}                       AS key,
                  COUNT(*)                           AS runs,
                  COALESCE(SUM(cost_usd),0)          AS totalUsd,
                  COALESCE(SUM(input_tokens),0)      AS inputTokens,
                  COALESCE(SUM(output_tokens),0)     AS outputTokens,
                  COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens
             FROM agent_runs
            WHERE started_at >= ?
            GROUP BY ${groupExpr}
            ORDER BY totalUsd DESC`,
        )
        .all(since) as Record<string, unknown>[];
      return rows.map((r) => ({
        key: (r['key'] ?? null) as string | null,
        runs: Number(r['runs'] ?? 0),
        totalUsd: Number(r['totalUsd'] ?? 0),
        inputTokens: Number(r['inputTokens'] ?? 0),
        outputTokens: Number(r['outputTokens'] ?? 0),
        cacheReadTokens: Number(r['cacheReadTokens'] ?? 0),
      }));
    },
  };

  return api;
}
