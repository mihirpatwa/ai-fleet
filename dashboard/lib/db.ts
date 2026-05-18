// Server-only read access to the daemon's SQLite state. A single shared
// read-only connection to the same ~/.aifleet/state.db the daemon writes
// (AIFLEET_DB_PATH override mirrors daemon/src/db.ts). The dashboard never
// writes — mutations go through the daemon HTTP API.
import 'server-only';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentRun,
  AgentSummary,
  CostRow,
  FleetEvent,
  SecurityFinding,
  Severity,
  Task,
  TaskMetrics,
  TaskNode,
} from './types';

type DB = Database.Database;

export function dbPath(): string {
  return process.env['AIFLEET_DB_PATH'] ?? join(homedir(), '.aifleet', 'state.db');
}

let conn: DB | null = null;
function db(): DB | null {
  if (conn) return conn;
  const path = dbPath();
  if (!existsSync(path)) return null; // daemon hasn't created it yet
  conn = new Database(path, { readonly: true, fileMustExist: true });
  conn.pragma('busy_timeout = 3000');
  return conn;
}

/** Run a read; if the DB/table isn't there yet, degrade to a fallback. */
function safe<T>(fn: (d: DB) => T, fallback: T): T {
  const d = db();
  if (!d) return fallback;
  try {
    return fn(d);
  } catch {
    return fallback;
  }
}

const json = (v: unknown): unknown => {
  if (v == null) return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
};

const TASK_COLS = `id, parent_id AS parentId, root_id AS rootId, project_root AS projectRoot,
  title, assigned_agent AS assignedAgent, status, depends_on AS dependsOn,
  input_json AS inputJson, output_json AS outputJson, progress, retry_count AS retryCount,
  error, created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt,
  finished_at AS finishedAt`;

function mapTask(r: Record<string, unknown>): Task {
  return {
    id: String(r['id']),
    parentId: (r['parentId'] as string) ?? null,
    rootId: String(r['rootId']),
    projectRoot: String(r['projectRoot']),
    title: String(r['title']),
    assignedAgent: String(r['assignedAgent']),
    status: r['status'] as Task['status'],
    dependsOn: (json(r['dependsOn']) as string[]) ?? [],
    inputJson: json(r['inputJson']),
    outputJson: json(r['outputJson']),
    progress: Number(r['progress'] ?? 0),
    retryCount: Number(r['retryCount'] ?? 0),
    error: (r['error'] as string) ?? null,
    createdAt: String(r['createdAt']),
    updatedAt: String(r['updatedAt']),
    startedAt: (r['startedAt'] as string) ?? null,
    finishedAt: (r['finishedAt'] as string) ?? null,
  };
}

export interface TaskFilter {
  project?: string;
  status?: string;
  root?: string;
  agent?: string;
}

export function listTasks(f: TaskFilter = {}): Task[] {
  return safe((d) => {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.project) {
      where.push('project_root = ?');
      args.push(f.project);
    }
    if (f.status) {
      where.push('status = ?');
      args.push(f.status);
    }
    if (f.root) {
      where.push('root_id = ?');
      args.push(f.root);
    }
    if (f.agent) {
      where.push('assigned_agent = ?');
      args.push(f.agent);
    }
    const sql = `SELECT ${TASK_COLS} FROM tasks ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY datetime(created_at) DESC, id DESC LIMIT 2000`;
    return (d.prepare(sql).all(...args) as Record<string, unknown>[]).map(mapTask);
  }, []);
}

export function getTask(id: string): Task | null {
  return safe((d) => {
    const r = d.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? mapTask(r) : null;
  }, null);
}

export function projects(): string[] {
  return safe(
    (d) =>
      (
        d.prepare('SELECT DISTINCT project_root AS p FROM tasks ORDER BY p').all() as {
          p: string;
        }[]
      ).map((r) => r.p),
    [],
  );
}

/** Root tasks — one per submitted goal. */
export function goals(project?: string): Task[] {
  return safe((d) => {
    const sql = `SELECT ${TASK_COLS} FROM tasks WHERE parent_id IS NULL ${
      project ? 'AND project_root = ?' : ''
    } ORDER BY datetime(created_at) DESC`;
    const rows = (project ? d.prepare(sql).all(project) : d.prepare(sql).all()) as Record<
      string,
      unknown
    >[];
    return rows.map(mapTask);
  }, []);
}

export function taskTree(rootId: string): TaskNode | null {
  const all = safe(
    (d) =>
      (
        d
          .prepare(`SELECT ${TASK_COLS} FROM tasks WHERE root_id = ? ORDER BY datetime(created_at)`)
          .all(rootId) as Record<string, unknown>[]
      ).map(mapTask),
    [] as Task[],
  );
  if (all.length === 0) return null;
  const byId = new Map<string, TaskNode>();
  for (const t of all) byId.set(t.id, { ...t, children: [] });
  let root: TaskNode | null = null;
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    if (node.id === rootId || node.parentId === null) root = root ?? node;
  }
  return byId.get(rootId) ?? root;
}

/** The subtree rooted at any task (built from its root_id family). */
export function taskSubtree(task: Task): TaskNode | null {
  const tree = taskTree(task.rootId);
  if (!tree) return null;
  const find = (n: TaskNode): TaskNode | null => {
    if (n.id === task.id) return n;
    for (const c of n.children) {
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  return find(tree);
}

function mapEvent(r: Record<string, unknown>): FleetEvent {
  return {
    id: Number(r['id']),
    taskId: (r['taskId'] as string) ?? null,
    agent: (r['agent'] as string) ?? null,
    type: r['type'] as FleetEvent['type'],
    payloadJson: json(r['payloadJson']),
    ts: String(r['ts']),
  };
}

export function listEvents(taskId: string, sinceId = 0, limit = 1000): FleetEvent[] {
  return safe(
    (d) =>
      (
        d
          .prepare(
            `SELECT id, task_id AS taskId, agent, type, payload_json AS payloadJson, ts
             FROM events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
          )
          .all(taskId, sinceId, limit) as Record<string, unknown>[]
      ).map(mapEvent),
    [],
  );
}

/** Latest tool a task invoked (newest tool_use_pre payload). */
export function latestTool(taskId: string): string | null {
  return safe((d) => {
    const r = d
      .prepare(
        `SELECT payload_json AS p FROM events
         WHERE task_id = ? AND type = 'tool_use_pre' ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId) as { p: string } | undefined;
    if (!r) return null;
    const payload = json(r.p) as { tool?: unknown } | null;
    return payload && typeof payload.tool === 'string' ? payload.tool : null;
  }, null);
}

/** Last human-readable log line for a task. */
export function lastLog(taskId: string): string | null {
  return safe((d) => {
    const r = d
      .prepare(
        `SELECT payload_json AS p FROM events
         WHERE task_id = ? AND type IN ('log','progress') ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId) as { p: string } | undefined;
    if (!r) return null;
    const payload = json(r.p) as Record<string, unknown> | null;
    if (!payload) return null;
    const text = payload['text'] ?? payload['message'] ?? payload['note'];
    return typeof text === 'string' ? text : JSON.stringify(payload);
  }, null);
}

function mapRun(r: Record<string, unknown>): AgentRun {
  return {
    id: String(r['id']),
    taskId: (r['taskId'] as string) ?? null,
    agent: String(r['agent']),
    model: String(r['model']),
    inputTokens: r['inputTokens'] == null ? null : Number(r['inputTokens']),
    outputTokens: r['outputTokens'] == null ? null : Number(r['outputTokens']),
    cacheReadTokens: r['cacheReadTokens'] == null ? null : Number(r['cacheReadTokens']),
    costUsd: r['costUsd'] == null ? null : Number(r['costUsd']),
    status: (r['status'] as string) ?? null,
    startedAt: (r['startedAt'] as string) ?? null,
    finishedAt: (r['finishedAt'] as string) ?? null,
  };
}

export function taskRuns(taskId: string): AgentRun[] {
  return safe(
    (d) =>
      (
        d
          .prepare(
            `SELECT id, task_id AS taskId, agent, model, input_tokens AS inputTokens,
              output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens,
              cost_usd AS costUsd, status, started_at AS startedAt, finished_at AS finishedAt
             FROM agent_runs WHERE task_id = ? ORDER BY started_at`,
          )
          .all(taskId) as Record<string, unknown>[]
      ).map(mapRun),
    [],
  );
}

export function taskMetrics(t: Task): TaskMetrics {
  const runs = taskRuns(t.id);
  const sum = (k: keyof AgentRun): number => runs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const start = t.startedAt ? Date.parse(t.startedAt + 'Z') : null;
  const end = t.finishedAt ? Date.parse(t.finishedAt + 'Z') : null;
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    costUsd: sum('costUsd'),
    runs: runs.length,
    durationMs: start && end ? end - start : null,
    retries: t.retryCount,
  };
}

export function agentSummaries(project?: string): AgentSummary[] {
  const tasks = listTasks(project ? { project } : {});
  const runs = safe(
    (d) =>
      d
        .prepare(
          `SELECT agent, COALESCE(SUM(cost_usd),0) AS cost, MAX(started_at) AS last
           FROM agent_runs GROUP BY agent`,
        )
        .all() as { agent: string; cost: number; last: string | null }[],
    [],
  );
  const runByAgent = new Map(runs.map((r) => [r.agent, r]));
  const byAgent = new Map<string, AgentSummary>();
  for (const t of tasks) {
    const s =
      byAgent.get(t.assignedAgent) ??
      ({
        agent: t.assignedAgent,
        running: 0,
        queued: 0,
        done: 0,
        failed: 0,
        total: 0,
        lastActivity: null,
        costUsd: 0,
      } as AgentSummary);
    s.total++;
    if (t.status === 'running') s.running++;
    else if (t.status === 'queued') s.queued++;
    else if (t.status === 'done') s.done++;
    else if (t.status === 'failed') s.failed++;
    const ts = t.updatedAt;
    if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    byAgent.set(t.assignedAgent, s);
  }
  for (const s of byAgent.values()) {
    const r = runByAgent.get(s.agent);
    if (r) {
      s.costUsd = r.cost;
      if (r.last && (!s.lastActivity || r.last > s.lastActivity)) s.lastActivity = r.last;
    }
  }
  return [...byAgent.values()].sort((a, b) => b.total - a.total);
}

export function costBreakdown(by: 'agent' | 'model' | 'day'): CostRow[] {
  const expr = by === 'agent' ? 'agent' : by === 'model' ? 'model' : 'date(started_at)';
  return safe(
    (d) =>
      (
        d
          .prepare(
            `SELECT ${expr} AS key, COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS costUsd,
              COALESCE(SUM(input_tokens),0) AS inputTokens,
              COALESCE(SUM(output_tokens),0) AS outputTokens,
              COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens
             FROM agent_runs GROUP BY ${expr} ORDER BY costUsd DESC`,
          )
          .all() as Record<string, unknown>[]
      ).map((r) => ({
        key: r['key'] == null ? '(none)' : String(r['key']),
        runs: Number(r['runs'] ?? 0),
        costUsd: Number(r['costUsd'] ?? 0),
        inputTokens: Number(r['inputTokens'] ?? 0),
        outputTokens: Number(r['outputTokens'] ?? 0),
        cacheReadTokens: Number(r['cacheReadTokens'] ?? 0),
      })),
    [],
  );
}

export function costTotals(): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  runs: number;
} {
  return safe(
    (d) => {
      const r = d
        .prepare(
          `SELECT COALESCE(SUM(cost_usd),0) AS costUsd, COALESCE(SUM(input_tokens),0) AS inputTokens,
            COALESCE(SUM(output_tokens),0) AS outputTokens,
            COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens, COUNT(*) AS runs
           FROM agent_runs`,
        )
        .get() as Record<string, number>;
      return {
        costUsd: Number(r['costUsd'] ?? 0),
        inputTokens: Number(r['inputTokens'] ?? 0),
        outputTokens: Number(r['outputTokens'] ?? 0),
        cacheReadTokens: Number(r['cacheReadTokens'] ?? 0),
        runs: Number(r['runs'] ?? 0),
      };
    },
    { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, runs: 0 },
  );
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, med: 2, low: 3 };

/** Flattened security-auditor findings across the project's audit tasks. */
export function securityFindings(project?: string): SecurityFinding[] {
  const tasks = listTasks({
    agent: 'security-auditor',
    ...(project ? { project } : {}),
  });
  const out: SecurityFinding[] = [];
  for (const t of tasks) {
    const o = (t.outputJson ?? null) as {
      blocking?: unknown;
      findings?: Array<Record<string, unknown>>;
    } | null;
    if (!o || !Array.isArray(o.findings)) continue;
    for (const f of o.findings) {
      const sev = String(f['severity']);
      out.push({
        taskId: t.id,
        projectRoot: t.projectRoot,
        taskStatus: t.status,
        blocking: o.blocking === true,
        severity: (['low', 'med', 'high', 'critical'].includes(sev) ? sev : 'low') as Severity,
        file: String(f['file'] ?? '?'),
        line: typeof f['line'] === 'number' ? f['line'] : null,
        rule: String(f['rule'] ?? '?'),
        message: String(f['message'] ?? ''),
        fixHint: typeof f['fix_hint'] === 'string' ? f['fix_hint'] : null,
        ts: t.updatedAt,
      });
    }
  }
  return out.sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.ts.localeCompare(a.ts),
  );
}
