import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { parseConfig } from '../src/config.js';
import { createAlerts } from '../src/alerts.js';

const silent = pino({ level: 'silent' });
let server: Server;
let received: Array<{ url: string; body: unknown }>;

beforeEach(async () => {
  received = [];
  server = createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      received.push({ url: req.url ?? '', body: JSON.parse(buf || '{}') });
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

function port(): number {
  return (server.address() as AddressInfo).port;
}

describe('alerts', () => {
  it('posts a generic_post payload with event, task id and dashboard link', async () => {
    const base = `http://127.0.0.1:${port()}`;
    const config = parseConfig({
      alerts: { dashboard_url: base, generic_post: `${base}/hook` },
    });
    const alerts = createAlerts(config, silent);
    await alerts.notify('goal_completed', { taskId: 'T1', summary: 'shipped' });

    expect(received).toHaveLength(1);
    const b = received[0]!.body as Record<string, unknown>;
    expect(b['event']).toBe('goal_completed');
    expect(b['taskId']).toBe('T1');
    expect(b['url']).toBe(`${base}/task/T1`);
    expect(b['summary']).toBe('shipped');
  });

  it('fans out to slack + discord with their payload shapes', async () => {
    const base = `http://127.0.0.1:${port()}`;
    const config = parseConfig({
      alerts: { slack_webhook: `${base}/slack`, discord_webhook: `${base}/discord` },
    });
    await createAlerts(config, silent).notify('security_blocking_finding', { taskId: 'T9' });
    const byUrl = Object.fromEntries(
      received.map((r) => [r.url, r.body as Record<string, unknown>]),
    );
    expect(typeof byUrl['/slack']?.['text']).toBe('string');
    expect(typeof byUrl['/discord']?.['content']).toBe('string');
    expect(String(byUrl['/slack']?.['text'])).toContain('security_blocking_finding');
  });

  it('is a no-throw no-op when no destinations are configured', async () => {
    const alerts = createAlerts(parseConfig({}), silent);
    await expect(alerts.notify('goal_failed', { taskId: 'T0' })).resolves.toBeUndefined();
    expect(received).toHaveLength(0);
  });
});
