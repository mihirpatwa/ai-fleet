// u16: HTTP-level coverage for PATCH /azure/work-items/:id with fetch mocked.
// Sets up a temp ~/.aifleet, primes the azure connection + PAT in
// secrets.env, then asserts the daemon's PATCH endpoint forwards the right
// JSON-patch ops to Azure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { FleetBus, createSessionTaskMap, type SessionTaskMap } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { createDb, type FleetDb } from '../src/db.js';
import { createServer } from '../src/server.js';
import { saveConnection, writePat } from '../src/azure/storage.js';

let db: FleetDb;
let bus: FleetBus;
let sessionMap: SessionTaskMap;
let app: FastifyInstance;
let HOME: string;
let savedHome: string | undefined;
let savedPat: string | undefined;

const ORG = 'https://dev.azure.com/contoso';
const PROJECT = 'demo';

const detailFixture = {
  id: 42,
  fields: {
    'System.Id': 42,
    'System.WorkItemType': 'User Story',
    'System.Title': 'Demo',
    'System.State': 'Active',
    'System.AssignedTo': { displayName: 'Alice' },
    'System.IterationPath': 'demo',
    'System.ChangedDate': '2025-01-01',
    'System.Tags': 'tag-a',
    'System.AreaPath': 'demo',
    'System.CreatedBy': { displayName: 'Bob' },
    'System.CreatedDate': '2025-01-01',
  },
  relations: [],
  url: 'https://dev.azure.com/contoso/_apis/wit/workItems/42',
};

beforeEach(async () => {
  HOME = mkdtempSync(join(tmpdir(), 'aifleet-azure-patch-'));
  savedHome = process.env['AIFLEET_HOME'];
  savedPat = process.env['AZURE_DEVOPS_PAT'];
  process.env['AIFLEET_HOME'] = HOME;
  delete process.env['AZURE_DEVOPS_PAT'];
  saveConnection({
    org_url: ORG,
    project: PROJECT,
    validated_at: new Date().toISOString(),
  });
  writePat('pat-token-123');

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
  vi.restoreAllMocks();
  if (savedHome === undefined) delete process.env['AIFLEET_HOME'];
  else process.env['AIFLEET_HOME'] = savedHome;
  if (savedPat === undefined) delete process.env['AZURE_DEVOPS_PAT'];
  else process.env['AZURE_DEVOPS_PAT'] = savedPat;
  rmSync(HOME, { recursive: true, force: true });
});

function mockFetchResponses(): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      // PATCH against /_apis/wit/workitems/:id — Azure echos the updated WI;
      // we only need .ok in the daemon path.
      if (url.includes('/_apis/wit/workitems/') && (init?.method ?? 'GET') === 'PATCH') {
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }
      // GET to refresh the detail after PATCH.
      return new Response(JSON.stringify(detailFixture), { status: 200 });
    }),
  );
  return calls;
}

describe('PATCH /azure/work-items/:id', () => {
  it('forwards a state-only patch as a JSON-patch op', async () => {
    const calls = mockFetchResponses();
    const res = await app.inject({
      method: 'PATCH',
      url: '/azure/work-items/42',
      payload: { state: 'QA' },
    });
    expect(res.statusCode).toBe(200);
    const patchCall = calls.find((c) => c.init?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall!.init!.body as string) ?? '[]') as Array<{
      op: string;
      path: string;
      value?: unknown;
    }>;
    expect(body).toEqual([{ op: 'add', path: '/fields/System.State', value: 'QA' }]);
  });

  it('forwards assigned_to=null as a remove op', async () => {
    const calls = mockFetchResponses();
    const res = await app.inject({
      method: 'PATCH',
      url: '/azure/work-items/42',
      payload: { assigned_to: null },
    });
    expect(res.statusCode).toBe(200);
    const patchCall = calls.find((c) => c.init?.method === 'PATCH');
    const body = JSON.parse((patchCall!.init!.body as string) ?? '[]') as Array<{
      op: string;
      path: string;
    }>;
    expect(body[0]?.op).toBe('remove');
    expect(body[0]?.path).toBe('/fields/System.AssignedTo');
  });

  it('combines multiple fields into one patch payload', async () => {
    const calls = mockFetchResponses();
    const res = await app.inject({
      method: 'PATCH',
      url: '/azure/work-items/42',
      payload: { state: 'QA', title: 'Updated', tags: 'a; b' },
    });
    expect(res.statusCode).toBe(200);
    const patchCall = calls.find((c) => c.init?.method === 'PATCH');
    const body = JSON.parse((patchCall!.init!.body as string) ?? '[]');
    expect(body.length).toBe(3);
  });

  it('rejects an empty body with 400', async () => {
    mockFetchResponses();
    const res = await app.inject({
      method: 'PATCH',
      url: '/azure/work-items/42',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /azure/work-items/:id/comments (v10)', () => {
  it('forwards the comment text to Azure and returns the refreshed list', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url, init });
        if (url.includes('/comments') && (init?.method ?? 'GET') === 'POST') {
          return new Response(JSON.stringify({ id: 1 }), { status: 200 });
        }
        if (url.includes('/comments')) {
          return new Response(
            JSON.stringify({
              comments: [
                {
                  id: 1,
                  text: 'hello',
                  createdBy: { displayName: 'Alice' },
                  createdDate: '2025-01-01',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/azure/work-items/42/comments',
      payload: { text: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { comments: Array<{ text_html: string }> };
    expect(body.comments?.[0]?.text_html).toBe('hello');

    const postCall = calls.find((c) => c.init?.method === 'POST');
    expect(postCall).toBeDefined();
    const sent = JSON.parse((postCall!.init!.body as string) ?? '{}');
    expect(sent.text).toBe('hello');
  });

  it('rejects an empty comment with 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/azure/work-items/42/comments',
      payload: { text: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
