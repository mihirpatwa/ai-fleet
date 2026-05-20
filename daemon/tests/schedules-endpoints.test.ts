// t15: HTTP-level coverage for the schedules CRUD endpoints. Spins up the
// daemon's Fastify instance against an in-memory DB and exercises GET / POST /
// PATCH / DELETE / run / preview directly.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { FleetBus, createSessionTaskMap, type SessionTaskMap } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { createDb, type FleetDb } from '../src/db.js';
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
    inFlight: () => 0,
  } as unknown as Parameters<typeof createServer>[0]);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('/schedules', () => {
  it('GET starts empty (default-seeded rows only appear under the scheduler)', async () => {
    const res = await app.inject({ method: 'GET', url: '/schedules' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ schedules: [] });
  });

  it('POST validates body and creates a row; PATCH updates; DELETE removes it', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/schedules',
      payload: { name: '', cron: '', agent: '' },
    });
    expect(bad.statusCode).toBe(400);

    const created = await app.inject({
      method: 'POST',
      url: '/schedules',
      payload: { name: 'cron-a', cron: '0 6 * * *', agent: 'scribe' },
    });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;
    expect(typeof id).toBe('string');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/schedules/${id}`,
      payload: { enabled: false, cron: '*/15 * * * *' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { enabled: boolean }).enabled).toBe(false);
    expect((updated.json() as { cron: string }).cron).toBe('*/15 * * * *');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/schedules/${id}`,
    });
    expect(deleted.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/schedules' });
    expect((after.json() as { schedules: unknown[] }).schedules.length).toBe(0);
  });

  it('PATCH rejects an invalid cron with 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/schedules',
      payload: { name: 'cron-b', cron: '0 6 * * *', agent: 'scribe' },
    });
    const id = (created.json() as { id: string }).id;
    const bad = await app.inject({
      method: 'PATCH',
      url: `/schedules/${id}`,
      payload: { cron: 'not a cron' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('POST /schedules/:id/run materializes a task and returns its id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/schedules',
      payload: { name: 'manual-fire', cron: '0 6 * * *', agent: 'scribe' },
    });
    const id = (created.json() as { id: string }).id;
    const fired = await app.inject({
      method: 'POST',
      url: `/schedules/${id}/run`,
    });
    expect(fired.statusCode).toBe(200);
    expect((fired.json() as { task_id: string }).task_id).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{26}$/,
    );
  });

  it('GET /schedules/preview validates cron + returns next runs', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/schedules/preview?cron=0%206%20*%20*%20*&count=3',
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { valid: boolean; next: string[] };
    expect(body.valid).toBe(true);
    expect(body.next.length).toBe(3);

    const bad = await app.inject({
      method: 'GET',
      url: '/schedules/preview?cron=not-a-cron',
    });
    expect((bad.json() as { valid: boolean }).valid).toBe(false);
  });
});
