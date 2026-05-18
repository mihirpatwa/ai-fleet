// Fleet configuration — loaded once from ~/.aifleet/config.yaml.
// The on-disk file is optional and may be partial; every key falls back to a
// default, so a missing file yields a fully-formed config. Keys are snake_case
// to match exactly what an operator writes in config.yaml.
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

/** Root of all runtime state. `AIFLEET_HOME` override keeps tests off the real ~/.aifleet. */
export function aifleetDir(): string {
  return process.env['AIFLEET_HOME'] ?? join(homedir(), '.aifleet');
}

export function getConfigPath(): string {
  return process.env['AIFLEET_CONFIG_PATH'] ?? join(aifleetDir(), 'config.yaml');
}

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

const retryPolicy = z
  .object({
    max_retries: z.number().int().min(0).default(3),
    backoff_ms: z.array(z.number().int().min(0)).nonempty().default([5000, 30000, 300000]),
  })
  .strict()
  .default({ max_retries: 3, backoff_ms: [5000, 30000, 300000] });

// Shadow-mode safety rail: the first N retrospect runs per project store
// lessons at low confidence and are kept out of the CLAUDE.md hot tier.
const memoryPolicy = z
  .object({
    shadow_runs: z.number().int().min(0).default(10),
  })
  .strict()
  .default({ shadow_runs: 10 });

// Phase-10 alerts. All destinations optional; dashboard_url builds the deep
// link included in every alert.
const alertsConfig = z
  .object({
    dashboard_url: z.string().default('http://localhost:3737'),
    slack_webhook: z.string().optional(),
    discord_webhook: z.string().optional(),
    generic_post: z.string().optional(),
    smtp: z
      .object({
        host: z.string(),
        port: z.number().int().default(587),
        from: z.string(),
        to: z.string(),
      })
      .optional(),
  })
  .default({ dashboard_url: 'http://localhost:3737' });

// `.strict()` is intentionally NOT used at the top level: an operator's
// config.yaml may carry forward keys from a newer daemon, and an unknown key
// should not crash startup. Nested policy objects stay strict.
export const fleetConfigSchema = z.object({
  max_concurrent_agents: z.number().int().min(1).default(3),
  poll_interval_ms: z.number().int().min(100).default(2000),
  server_port: z.number().int().min(1).max(65535).default(7878),
  default_model: z.string().min(1).default('claude-sonnet-4-6'),
  orchestrator_model: z.string().min(1).default('claude-opus-4-7'),
  per_agent_models: z.record(z.string(), z.string()).default({}),
  cost_cap_per_hour_usd: z.number().min(0).default(5.0),
  // Phase-8 circuit breakers (per-agent/hour + per-task absolute).
  per_agent_hourly_cap: z.number().min(0).default(0.5),
  per_task_cap_usd: z.number().min(0).default(1.0),
  // Phase-9 adaptive memory.
  embeddings_provider: z.string().default('off'),
  memory: memoryPolicy,
  // Phase-10 alerts/webhooks.
  alerts: alertsConfig,
  retry_policy: retryPolicy,
  log_level: z.enum(LOG_LEVELS).default('info'),
});

export type FleetConfig = z.infer<typeof fleetConfigSchema>;

/** Parse + default-fill a raw config object (e.g. from YAML). Exposed for tests. */
export function parseConfig(raw: unknown): FleetConfig {
  const obj = raw == null ? {} : raw;
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('config.yaml must contain a top-level mapping');
  }
  return fleetConfigSchema.parse(obj);
}

/**
 * Load config from `path` (default {@link getConfigPath}). A missing file is
 * not an error — defaults apply. A present-but-malformed file throws with a
 * path-prefixed message so the operator can fix it.
 */
export function loadConfig(path: string = getConfigPath()): FleetConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseConfig({});
    throw err;
  }
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return parseConfig(doc);
  } catch (err) {
    throw new Error(`invalid config ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
