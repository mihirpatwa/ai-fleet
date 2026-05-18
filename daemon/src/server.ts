// Control + observability plane. Fastify on config.server_port exposes health,
// Prometheus metrics, task CRUD, the hook event-ingestion endpoint, and a
// WebSocket that fans out every freshly-inserted event row in real time.
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { FleetBus, SessionTaskMap } from './bus.js';
import type { FleetConfig } from './config.js';
import { EVENT_TYPES, TASK_STATUSES, tsMsAgo, type FleetDb, type TaskStatus } from './db.js';
import { recordAndBroadcast } from './events.js';
import { deleteMemory, getMemory, listMemories, pinMemory, updateLesson } from './memory.js';

export interface ServerDeps {
  db: FleetDb;
  config: FleetConfig;
  bus: FleetBus;
  sessionMap: SessionTaskMap;
  logger: Logger;
  /** Live SDK query count, surfaced in /metrics. */
  inFlight?: () => number;
}

const createTaskBody = z
  .object({
    goal: z.string().min(1),
    project_root: z.string().min(1),
    agent: z.string().min(1).optional(),
  })
  .strict();

const postEventBody = z
  .object({
    task_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    event_type: z.enum(EVENT_TYPES),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_output: z.unknown().optional(),
  })
  .strict();

function prom(
  lines: Array<[string, string, 'gauge' | 'counter', Array<[Record<string, string>, number]>]>,
): string {
  const out: string[] = [];
  for (const [name, help, type, samples] of lines) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) {
      const lbl = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      out.push(`${name}${lbl ? `{${lbl}}` : ''} ${value}`);
    }
  }
  return out.join('\n') + '\n';
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { db, bus, sessionMap, logger } = deps;
  // Fastify's own request logger stays off: the daemon logs notable events
  // through its pino instance and exposes the rest via /metrics. (Passing a
  // typed pino instance here would also rebind the FastifyInstance logger
  // generic and break the declared return type under exactOptionalPropertyTypes.)
  const app = Fastify();
  await app.register(fastifyWebsocket);

  app.get('/healthz', () => ({ ok: true, uptime: process.uptime() }));

  app.get('/metrics', (_req, reply) => {
    const statusRows = db.raw
      .prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status')
      .all() as Array<{ status: string; c: number }>;
    const byStatus = new Map(statusRows.map((r) => [r.status, r.c]));
    const events = db.raw.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number };
    const cost = db.costSince(tsMsAgo(3_600_000));
    const body = prom([
      ['aifleet_up', 'Daemon liveness', 'gauge', [[{}, 1]]],
      ['aifleet_uptime_seconds', 'Process uptime', 'gauge', [[{}, Math.floor(process.uptime())]]],
      [
        'aifleet_tasks',
        'Task count by status',
        'gauge',
        TASK_STATUSES.map(
          (s) => [{ status: s }, byStatus.get(s) ?? 0] as [Record<string, string>, number],
        ),
      ],
      ['aifleet_events_total', 'Total recorded events', 'counter', [[{}, events.c]]],
      ['aifleet_cost_usd_last_hour', 'Agent cost in the last hour', 'gauge', [[{}, cost.totalUsd]]],
      ['aifleet_agent_runs_last_hour', 'Agent runs in the last hour', 'gauge', [[{}, cost.runs]]],
      [
        'aifleet_agents_in_flight',
        'Currently streaming SDK queries',
        'gauge',
        [[{}, deps.inFlight ? deps.inFlight() : 0]],
      ],
    ]);
    void reply.header('content-type', 'text/plain; version=0.0.4');
    return body;
  });

  app.post('/tasks', (req, reply) => {
    const parsed = createTaskBody.safeParse(req.body);
    if (!parsed.success) {
      void reply.code(400);
      return { error: 'invalid body', detail: parsed.error.flatten() };
    }
    const { goal, project_root, agent } = parsed.data;
    const task = db.createTask({
      projectRoot: project_root,
      title: goal,
      assignedAgent: agent ?? 'orchestrator',
      // Superset the subagents' input schemas read: orchestrator wants
      // `goal`+`repoRoot`, doc-writer/others want `task`+`repoRoot`.
      inputJson: { goal, task: goal, repoRoot: project_root },
    });
    logger.info({ taskId: task.id, agent: task.assignedAgent }, 'task created via API');
    void reply.code(201);
    return task;
  });

  app.get('/tasks', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const status =
      q['status'] && (TASK_STATUSES as readonly string[]).includes(q['status'])
        ? (q['status'] as TaskStatus)
        : undefined;
    return db.queryTasks({
      ...(status ? { status } : {}),
      ...(q['project_root'] ? { project: q['project_root'] } : {}),
    });
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    return task;
  });

  // Dashboard task actions. Status transitions reuse the same db.updateTask
  // path the loop uses; a log event is broadcast so the UI reflects it live.
  app.post<{ Params: { id: string } }>('/tasks/:id/cancel', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    const terminal = ['done', 'failed', 'cancelled'];
    if (terminal.includes(task.status)) {
      void reply.code(409);
      return { error: `task already ${task.status}` };
    }
    const updated = db.updateTask(task.id, { status: 'cancelled' });
    recordAndBroadcast(db, bus, {
      taskId: task.id,
      agent: task.assignedAgent,
      type: 'log',
      payloadJson: { action: 'cancelled via dashboard' },
    });
    logger.info({ taskId: task.id }, 'task cancelled via API');
    return updated;
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/retry', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    if (task.status !== 'failed') {
      void reply.code(409);
      return { error: `only failed tasks can be retried (is ${task.status})` };
    }
    const updated = db.updateTask(task.id, {
      status: 'queued',
      error: null,
      retryCount: 0,
    });
    recordAndBroadcast(db, bus, {
      taskId: task.id,
      agent: task.assignedAgent,
      type: 'log',
      payloadJson: { action: 'retry requeued via dashboard' },
    });
    logger.info({ taskId: task.id }, 'task retried via API');
    return updated;
  });

  // Phase-9 memory surface (dashboard reads + per-row actions).
  app.get('/memory', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    return listMemories(db, {
      ...(q['project_root'] ? { projectRoot: q['project_root'] } : {}),
      ...(q['agent'] ? { agent: q['agent'] } : {}),
      limit: q['limit'] ? Number(q['limit']) : 200,
    });
  });

  app.post<{ Params: { id: string } }>('/memory/:id/pin', (req, reply) => {
    const m = getMemory(db, req.params.id);
    if (!m) {
      void reply.code(404);
      return { error: 'memory not found' };
    }
    const body = (req.body ?? {}) as { pinned?: unknown };
    pinMemory(db, req.params.id, body.pinned === true);
    return getMemory(db, req.params.id);
  });

  app.patch<{ Params: { id: string } }>('/memory/:id', (req, reply) => {
    const m = getMemory(db, req.params.id);
    if (!m) {
      void reply.code(404);
      return { error: 'memory not found' };
    }
    const body = (req.body ?? {}) as { lesson?: unknown };
    if (body.lesson === undefined) {
      void reply.code(400);
      return { error: 'body.lesson required' };
    }
    updateLesson(db, req.params.id, body.lesson);
    return getMemory(db, req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/memory/:id', (req, reply) => {
    const m = getMemory(db, req.params.id);
    if (!m) {
      void reply.code(404);
      return { error: 'memory not found' };
    }
    deleteMemory(db, req.params.id);
    return { ok: true, id: req.params.id };
  });

  app.get('/events', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const since = q['since'] ? Number(q['since']) : undefined;
    return db.listEvents({
      ...(q['task_id'] ? { taskId: q['task_id'] } : {}),
      ...(since !== undefined && Number.isFinite(since) ? { sinceId: since } : {}),
      order: 'asc',
      limit: 1000,
    });
  });

  app.post('/events', (req, reply) => {
    const parsed = postEventBody.safeParse(req.body);
    if (!parsed.success) {
      void reply.code(400);
      return { error: 'invalid body', detail: parsed.error.flatten() };
    }
    const b = parsed.data;
    const taskId = b.task_id ?? (b.session_id ? sessionMap.get(b.session_id) : undefined);
    const payload: Record<string, unknown> = {};
    if (b.tool_name !== undefined) payload['tool'] = b.tool_name;
    if (b.tool_input !== undefined) payload['input'] = b.tool_input;
    if (b.tool_output !== undefined) payload['output'] = b.tool_output;
    const row = recordAndBroadcast(db, bus, {
      ...(taskId ? { taskId } : {}),
      type: b.event_type,
      ...(Object.keys(payload).length ? { payloadJson: payload as never } : {}),
    });
    void reply.code(201);
    return row;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = bus.onEvent((row) => {
      if (socket.readyState === 1 /* WebSocket.OPEN */) {
        try {
          socket.send(JSON.stringify(row));
        } catch (err) {
          logger.warn({ err }, 'ws send failed');
        }
      }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  return app;
}
