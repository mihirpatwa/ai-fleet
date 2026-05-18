// Thin daemon HTTP client over undici.
import { request } from 'undici';
import { daemonUrl } from './paths.js';

export async function getJson<T = unknown>(path: string): Promise<T> {
  const res = await request(`${daemonUrl}${path}`);
  const body = await res.body.json();
  if (res.statusCode >= 400) {
    throw new Error(`GET ${path} -> ${res.statusCode}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

export async function postJson<T = unknown>(path: string, payload?: unknown): Promise<T> {
  // Only advertise a JSON body when one exists — Fastify rejects an empty
  // body sent with content-type: application/json (bodyless POSTs like
  // /tasks/:id/cancel).
  const res = await request(
    `${daemonUrl}${path}`,
    payload === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
  );
  const body = await res.body.json();
  if (res.statusCode >= 400) {
    throw new Error(`POST ${path} -> ${res.statusCode}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

/** True if `url` answers with a non-5xx status within the timeout. */
export async function reachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
    res.body.dump();
    return res.statusCode < 500;
  } catch {
    return false;
  }
}

/** Poll `fn` until it resolves truthy or the deadline passes. */
export async function waitFor(
  fn: () => Promise<boolean>,
  { timeoutMs = 15000, intervalMs = 1000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
