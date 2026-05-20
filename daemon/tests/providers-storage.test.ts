// q6: provider storage tests. Exercises the secrets.env file format,
// autoDetectProvider's first-boot synthesis, and the disconnect path that
// scrubs the env var.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyConnect,
  autoDetectProvider,
  clearSecretFor,
  clearState,
  currentState,
  envKeyFor,
  loadState,
  readSecrets,
} from '../src/providers/storage.js';

let HOME: string;
let savedHome: string | undefined;
let savedKey: string | undefined;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), 'aifleet-prov-'));
  savedHome = process.env['AIFLEET_HOME'];
  savedKey = process.env['ANTHROPIC_API_KEY'];
  process.env['AIFLEET_HOME'] = HOME;
  delete process.env['ANTHROPIC_API_KEY'];
});

afterEach(() => {
  if (savedHome === undefined) delete process.env['AIFLEET_HOME'];
  else process.env['AIFLEET_HOME'] = savedHome;
  if (savedKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = savedKey;
  try {
    rmSync(HOME, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('envKeyFor', () => {
  it('maps providers to env vars', () => {
    expect(envKeyFor('claude')).toBe('ANTHROPIC_API_KEY');
    expect(envKeyFor('codex')).toBe('OPENAI_API_KEY');
  });
});

describe('applyConnect + disconnect', () => {
  it('persists API key to secrets.env and into process.env', () => {
    const state = applyConnect({ name: 'claude', auth: 'api_key', api_key: 'sk-ant-abcdef1234' });
    expect(state.connected).toBe(true);
    expect(state.name).toBe('claude');
    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-abcdef1234');
    expect(readSecrets()['ANTHROPIC_API_KEY']).toBe('sk-ant-abcdef1234');
    const text = readFileSync(join(HOME, 'secrets.env'), 'utf8');
    expect(text).toContain('ANTHROPIC_API_KEY=sk-ant-abcdef1234');
  });

  it('local auth saves state without writing a secret', () => {
    const state = applyConnect({ name: 'claude', auth: 'local' });
    expect(state.connected).toBe(true);
    expect(state.auth).toBe('local');
    expect(existsSync(join(HOME, 'secrets.env'))).toBe(false);
  });

  it('clearSecretFor scrubs the env var from disk and process.env', () => {
    applyConnect({ name: 'claude', auth: 'api_key', api_key: 'sk-ant-xxxxxxxxxx' });
    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-xxxxxxxxxx');
    clearSecretFor('claude');
    expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(readSecrets()['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('clearState resets provider.json', () => {
    applyConnect({ name: 'claude', auth: 'local' });
    expect(loadState().connected).toBe(true);
    clearState();
    expect(loadState().connected).toBe(false);
    expect(loadState().name).toBeNull();
  });
});

describe('autoDetectProvider', () => {
  it('synthesizes a connected claude state when ANTHROPIC_API_KEY is set on first boot', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-from-shell';
    const synth = autoDetectProvider();
    expect(synth).not.toBeNull();
    expect(synth?.name).toBe('claude');
    expect(synth?.auth).toBe('api_key');
    expect(currentState().connected).toBe(true);
  });

  it('does nothing if a provider is already configured', () => {
    applyConnect({ name: 'claude', auth: 'local' });
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-from-shell';
    expect(autoDetectProvider()).toBeNull();
  });

  it('does nothing without ANTHROPIC_API_KEY', () => {
    expect(autoDetectProvider()).toBeNull();
    expect(currentState().connected).toBe(false);
  });
});

describe('currentState', () => {
  it('flips to disconnected if the API key vanishes', () => {
    applyConnect({ name: 'claude', auth: 'api_key', api_key: 'sk-ant-xxxxxxxxxx' });
    delete process.env['ANTHROPIC_API_KEY'];
    const state = currentState();
    expect(state.connected).toBe(false);
    expect(state.error).toMatch(/ANTHROPIC_API_KEY/);
  });
});
