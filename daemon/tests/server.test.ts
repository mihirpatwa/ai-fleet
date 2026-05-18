import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { FleetBus, createSessionTaskMap, type SessionTaskMap } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { createDb, type FleetDb, type FleetEvent } from '../src/db.js';
import { createServer } from '../src/server.js';

let db: FleetDb;
let bus: FleetBus;
let sessionMap: SessionTaskMap;
let app: FastifyInstance;

beforeEach(async () => {
  db = createDb({ path: ':memory:' });
  bus = new FleetBus();
  sessionMap = createSessionTaskMap();
  app = await createServer({
    db,
    config: parseConfig({}),
    bus,
    sessionMap,
    logger: pino({ level: 'silent' }),
    inFlight: () => 2,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('server', () => {
  it('GET /healthz reports ok + uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(typeof res.json().uptime).toBe('number');
  });

  it('POST /tasks validates body and creates a root task', async () => {
    const bad = await app.inject({ method: 'POST', url: '/tasks', payload: { goal: 'x' } });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { goal: 'add a thing', project_root: '/tmp/proj', agent: 'doc-writer' },
    });
    expect(res.statusCode).toBe(201);
    const task = res.json();
    expect(task.assignedAgent).toBe('doc-writer');
    expect(task.status).toBe('queued');
    expect(task.inputJson).toMatchObject({ goal: 'add a thing', task: 'add a thing' });

    const list = await app.inject({ method: 'GET', url: '/tasks?status=queued' });
    expect(list.json()).toHaveLength(1);
    const one = await app.inject({ method: 'GET', url: `/tasks/${task.id}` });
    expect(one.json().id).toBe(task.id);
    const missing = await app.inject({ method: 'GET', url: '/tasks/NOPE' });
    expect(missing.statusCode).toBe(404);
  });

  it('defaults the agent to orchestrator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { goal: 'g', project_root: '/tmp/p' },
    });
    expect(res.json().assignedAgent).toBe('orchestrator');
  });

  it('POST /events resolves task from the session map, redacts, and broadcasts', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { goal: 'g', project_root: '/tmp/p' },
    });
    const taskId = created.json().id as string;
    sessionMap.set('sess-1', taskId);

    const seen: FleetEvent[] = [];
    bus.onEvent((row) => seen.push(row));

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        session_id: 'sess-1',
        event_type: 'tool_use_post',
        tool_name: 'Bash',
        tool_input: { cmd: 'echo hi' },
        tool_output: `token sk-${'a'.repeat(40)}`,
      },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();
    expect(row.taskId).toBe(taskId);
    expect(JSON.stringify(row.payloadJson)).toContain('[REDACTED:llm_key]');
    expect(JSON.stringify(row.payloadJson)).not.toContain('sk-aaaa');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe('tool_use_post');

    const list = await app.inject({ method: 'GET', url: `/events?task_id=${taskId}` });
    expect(list.json().some((e: FleetEvent) => e.type === 'tool_use_post')).toBe(true);

    const badType = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { event_type: 'not_a_type' },
    });
    expect(badType.statusCode).toBe(400);
  });

  it('GET /metrics emits Prometheus text', async () => {
    await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { goal: 'g', project_root: '/tmp/p' },
    });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('aifleet_up 1');
    expect(res.body).toContain('aifleet_tasks{status="queued"} 1');
    expect(res.body).toContain('aifleet_agents_in_flight 2');
  });
});
