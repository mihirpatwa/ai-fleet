// Phase 13: dynamic model registry. The live list comes from Anthropic's
// /v1/models when an ANTHROPIC_API_KEY is configured; otherwise the daemon
// runs on a bundled known-good list (and whatever it last persisted to
// ~/.aifleet/models.json). Cached 1h in memory, refreshed hourly in the
// background, with the cached file loaded immediately on startup.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { aifleetDir } from './config.js';

export interface RawModel {
  id: string;
  display_name: string;
  type: string;
  created_at: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  context_window: number;
  recommended_for: string[];
}

const ANTHROPIC_BASE = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const REFRESH_MS = 60 * 60 * 1000; // 1h

// Known-good fallback. Used verbatim when there's no API key and no persisted
// models.json yet. display_name/created_at mirror what the API would return.
const BUNDLED: RawModel[] = [
  { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7', type: 'model', created_at: '2026-01-01' },
  { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', type: 'model', created_at: '2025-09-01' },
  { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', type: 'model', created_at: '2025-09-01' },
  { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', type: 'model', created_at: '2025-05-01' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', type: 'model', created_at: '2025-10-01' },
];

// /v1/models does not return context windows; this is the known-good map.
const CTX_DEFAULT = 200_000;
function contextWindow(id: string): number {
  if (/opus-4-7/.test(id)) return 200_000; // 1M is a separate beta header
  return CTX_DEFAULT;
}

/** Heuristic role recommendations from the tier in the id/display name. */
export function recommendedFor(id: string, displayName: string): string[] {
  const s = `${id} ${displayName}`.toLowerCase();
  if (s.includes('opus')) return ['orchestrator', 'planner'];
  if (s.includes('haiku')) return ['scribe', 'retrospector'];
  if (s.includes('sonnet')) return ['general'];
  return ['general'];
}

export type Tier = 'Opus' | 'Sonnet' | 'Haiku' | 'Other';
export function tierOf(id: string, displayName: string): Tier {
  const s = `${id} ${displayName}`.toLowerCase();
  if (s.includes('opus')) return 'Opus';
  if (s.includes('sonnet')) return 'Sonnet';
  if (s.includes('haiku')) return 'Haiku';
  return 'Other';
}

function modelsJsonPath(): string {
  return join(aifleetDir(), 'models.json');
}

function toInfo(m: RawModel): ModelInfo {
  return {
    id: m.id,
    display_name: m.display_name,
    context_window: contextWindow(m.id),
    recommended_for: recommendedFor(m.id, m.display_name),
  };
}

export interface ModelRegistry {
  /** Enriched list for GET /models. */
  list(): ModelInfo[];
  /** Raw ids only (validation). */
  ids(): string[];
  has(id: string): boolean;
  /** Force a refetch (POST /models/refresh). Returns the fresh list. */
  refresh(): Promise<ModelInfo[]>;
  /** Load cache immediately, then refresh in the background + every hour. */
  start(): void;
  stop(): void;
}

export function createModelRegistry(logger: Logger): ModelRegistry {
  let raw: RawModel[] = BUNDLED;
  let fetchedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function persist(): void {
    try {
      writeFileSync(modelsJsonPath(), JSON.stringify({ fetchedAt, data: raw }, null, 2));
    } catch (err) {
      logger.warn({ err }, 'could not persist models.json');
    }
  }

  function loadCached(): void {
    try {
      const j = JSON.parse(readFileSync(modelsJsonPath(), 'utf8')) as {
        fetchedAt?: number;
        data?: RawModel[];
      };
      if (Array.isArray(j.data) && j.data.length > 0) {
        raw = j.data;
        fetchedAt = j.fetchedAt ?? 0;
        logger.info({ count: raw.length }, 'models loaded from cache');
      }
    } catch {
      // No cache yet — seed the file from the bundled list.
      persist();
    }
  }

  async function fetchFromAnthropic(): Promise<RawModel[] | null> {
    const key = process.env['ANTHROPIC_API_KEY'];
    if (!key) return null; // no key → stay on bundled/cached
    try {
      const res = await fetch(`${ANTHROPIC_BASE}/v1/models?limit=100`, {
        headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'anthropic /v1/models non-OK; keeping cached');
        return null;
      }
      const body = (await res.json()) as { data?: RawModel[] };
      if (!Array.isArray(body.data) || body.data.length === 0) return null;
      return body.data.map((m) => ({
        id: m.id,
        display_name: m.display_name ?? m.id,
        type: m.type ?? 'model',
        created_at: m.created_at ?? '',
      }));
    } catch (err) {
      logger.warn({ err }, 'anthropic /v1/models fetch failed; keeping cached');
      return null;
    }
  }

  async function refresh(): Promise<ModelInfo[]> {
    const fresh = await fetchFromAnthropic();
    if (fresh) {
      raw = fresh;
      fetchedAt = Date.now();
      persist();
      logger.info({ count: raw.length }, 'models refreshed from anthropic');
    }
    return list();
  }

  function list(): ModelInfo[] {
    return raw.map(toInfo);
  }

  return {
    list,
    ids: () => raw.map((m) => m.id),
    has: (id) => raw.some((m) => m.id === id),
    refresh,
    start() {
      loadCached();
      // Stale (or never fetched) → kick a background refresh now.
      if (Date.now() - fetchedAt > REFRESH_MS) void refresh();
      timer = setInterval(() => void refresh(), REFRESH_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
