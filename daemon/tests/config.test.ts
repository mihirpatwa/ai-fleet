import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { ulid } from 'ulid';
import { loadConfig, parseConfig } from '../src/config.js';

describe('config', () => {
  it('fills every default when given an empty object', () => {
    const c = parseConfig({});
    expect(c.max_concurrent_agents).toBe(3);
    expect(c.poll_interval_ms).toBe(2000);
    expect(c.server_port).toBe(7878);
    expect(c.default_model).toBe('claude-sonnet-4-6');
    expect(c.orchestrator_model).toBe('claude-opus-4-7');
    expect(c.per_agent_models).toEqual({});
    expect(c.cost_cap_per_hour_usd).toBe(5.0);
    expect(c.per_agent_hourly_cap).toBe(0.5);
    expect(c.per_task_cap_usd).toBe(1.0);
    expect(c.embeddings_provider).toBe('off');
    expect(c.memory).toEqual({ shadow_runs: 10 });
    expect(c.alerts).toEqual({ dashboard_url: 'http://localhost:3737' });
    expect(c.retry_policy).toEqual({ max_retries: 3, backoff_ms: [5000, 30000, 300000] });
    expect(c.log_level).toBe('info');
  });

  it('merges a partial config over defaults', () => {
    const c = parseConfig({
      max_concurrent_agents: 8,
      per_agent_models: { coder: 'claude-opus-4-7' },
      retry_policy: { max_retries: 1, backoff_ms: [1000] },
    });
    expect(c.max_concurrent_agents).toBe(8);
    expect(c.poll_interval_ms).toBe(2000); // untouched default
    expect(c.per_agent_models['coder']).toBe('claude-opus-4-7');
    expect(c.retry_policy.backoff_ms).toEqual([1000]);
  });

  it('returns defaults when the file is missing', () => {
    const missing = join(tmpdir(), `aifleet-no-such-${ulid()}.yaml`);
    expect(loadConfig(missing).server_port).toBe(7878);
  });

  it('loads + validates a YAML file on disk', () => {
    const file = join(tmpdir(), `aifleet-cfg-${ulid()}.yaml`);
    writeFileSync(
      file,
      'server_port: 9090\nlog_level: debug\nper_agent_models:\n  tester: claude-haiku-4-5\n',
    );
    try {
      const c = loadConfig(file);
      expect(c.server_port).toBe(9090);
      expect(c.log_level).toBe('debug');
      expect(c.per_agent_models['tester']).toBe('claude-haiku-4-5');
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('rejects a non-mapping document and invalid nested policy', () => {
    expect(() => parseConfig('just a string')).toThrow(/mapping/);
    expect(() => parseConfig({ retry_policy: { max_retries: 2, backoff_ms: [] } })).toThrow();
    expect(() => parseConfig({ log_level: 'loud' })).toThrow();
  });
});
