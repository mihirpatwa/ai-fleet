// q6: adaptive heuristic tests. Pure function — easy to assert against.
import { describe, expect, it } from 'vitest';
import { isAdaptive, pickAdaptiveModel, ADAPTIVE_SENTINEL } from '../src/providers/adaptive.js';
import { parseConfig, type FleetConfig } from '../src/config.js';

function cfg(): FleetConfig {
  return parseConfig({
    model_selection: {
      default: 'claude-sonnet-4-6',
      orchestrator: 'claude-opus-4-7',
      per_task_allow_override: true,
    },
  });
}

describe('isAdaptive', () => {
  it('matches the sentinel exactly', () => {
    expect(isAdaptive(ADAPTIVE_SENTINEL)).toBe(true);
    expect(isAdaptive('__adaptive__')).toBe(true);
    expect(isAdaptive('claude-opus-4-7')).toBe(false);
    expect(isAdaptive(null)).toBe(false);
    expect(isAdaptive(undefined)).toBe(false);
  });
});

describe('pickAdaptiveModel', () => {
  const c = cfg();

  it('puts orchestrator on opus by default', () => {
    expect(pickAdaptiveModel(c, 'orchestrator', 'Make a small change')).toBe('claude-opus-4-7');
  });

  it('puts coder on sonnet by default', () => {
    expect(pickAdaptiveModel(c, 'coder', 'add a button')).toBe('claude-sonnet-4-6');
  });

  it('downgrades coder on trivial titles', () => {
    // "fix typo" matches the easy regex; coder (sonnet) downgrades to haiku.
    expect(pickAdaptiveModel(c, 'coder', 'fix typo in README')).toBe('claude-haiku-4-5');
  });

  it('upgrades coder on hard titles', () => {
    expect(
      pickAdaptiveModel(c, 'coder', 'Refactor the auth middleware to eliminate the deadlock'),
    ).toBe('claude-opus-4-7');
  });

  it('keeps scribe on haiku for short titles', () => {
    expect(pickAdaptiveModel(c, 'scribe', 'daily summary')).toBe('claude-haiku-4-5');
  });

  it('upgrades scribe to sonnet on long/hard titles', () => {
    const long = 'investigate the performance regression we saw after migrating the data warehouse to BigQuery and produce a root-cause analysis with remediation steps and benchmarks';
    expect(pickAdaptiveModel(c, 'scribe', long)).toBe('claude-sonnet-4-6');
  });

  it('falls back to sonnet for unknown agents', () => {
    expect(pickAdaptiveModel(c, 'some-random-agent', 'do work')).toBe('claude-sonnet-4-6');
  });
});
