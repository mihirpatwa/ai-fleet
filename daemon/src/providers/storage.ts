// Phase 18: provider state + secrets persistence.
//
// Two files in ~/.aifleet/ (override via AIFLEET_HOME):
//   provider.json  — non-secret state (name, auth method, validated_at)
//   secrets.env    — KEY=value lines, chmod 600. The daemon `load()`s this
//                    into process.env on startup so spawn.ts (still using the
//                    Claude SDK directly) picks up ANTHROPIC_API_KEY etc.
//                    transparently.
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { aifleetDir } from '../config.js';
import type { AuthMethod, ProviderName, ProviderState } from './types.js';

const PROVIDER_FILE = 'provider.json';
const SECRETS_FILE = 'secrets.env';

function providerPath(): string {
  return join(aifleetDir(), PROVIDER_FILE);
}
function secretsPath(): string {
  return join(aifleetDir(), SECRETS_FILE);
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/* ---------------------- provider.json (state) ---------------------- */

const DEFAULT_STATE: ProviderState = {
  name: null,
  connected: false,
  auth: null,
  validated_at: null,
  error: null,
};

export function loadState(): ProviderState {
  try {
    const raw = readFileSync(providerPath(), 'utf8');
    const j = JSON.parse(raw) as Partial<ProviderState>;
    return { ...DEFAULT_STATE, ...j };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: ProviderState): void {
  ensureDir(providerPath());
  writeFileSync(providerPath(), JSON.stringify(state, null, 2));
}

export function clearState(): void {
  saveState({ ...DEFAULT_STATE });
}

/* -------------------------- secrets.env --------------------------- */

/** Parse KEY=value lines. Lines starting with '#' or empty lines are ignored. */
function parseSecrets(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function serializeSecrets(kv: Record<string, string>): string {
  const header =
    '# ai-fleet provider secrets. chmod 600 — do not commit.\n' +
    '# managed by daemon/src/providers/storage.ts via the first-run modal.\n';
  const body = Object.entries(kv)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  return `${header}${body}\n`;
}

export function readSecrets(): Record<string, string> {
  try {
    return parseSecrets(readFileSync(secretsPath(), 'utf8'));
  } catch {
    return {};
  }
}

/** Merge `next` into the on-disk secrets file; chmod 600 after write. */
export function writeSecrets(next: Record<string, string>): void {
  const merged = { ...readSecrets(), ...next };
  ensureDir(secretsPath());
  writeFileSync(secretsPath(), serializeSecrets(merged), 'utf8');
  try {
    chmodSync(secretsPath(), 0o600);
  } catch {
    /* non-POSIX (Windows) — best-effort */
  }
}

/** Inject every secret into process.env unless the variable is already set. */
export function loadSecretsIntoEnv(): void {
  if (!existsSync(secretsPath())) return;
  for (const [k, v] of Object.entries(readSecrets())) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

/* ------------------------- env-key mapping ------------------------- */

/** Which env var holds the API key for each provider. */
export function envKeyFor(name: ProviderName): string {
  switch (name) {
    case 'claude':
      return 'ANTHROPIC_API_KEY';
    case 'codex':
      return 'OPENAI_API_KEY';
  }
}

/* ----------------------------- helpers ----------------------------- */

/**
 * Snapshot the provider state to send to the dashboard. Reads the JSON file
 * AND checks process.env, so a user who set ANTHROPIC_API_KEY in their shell
 * (without going through the modal) is reported as connected.
 */
export function currentState(): ProviderState {
  const state = loadState();
  if (state.connected && state.name && state.auth === 'api_key') {
    // Make sure the secret is still present.
    const key = envKeyFor(state.name);
    if (!process.env[key]) {
      return { ...state, connected: false, error: `${key} missing from env/secrets.env` };
    }
  }
  return state;
}

/** Persist a successful connection. Writes provider.json + secrets.env. */
export function applyConnect(opts: {
  name: ProviderName;
  auth: AuthMethod;
  api_key?: string;
}): ProviderState {
  if (opts.auth === 'api_key' && opts.api_key) {
    const key = envKeyFor(opts.name);
    writeSecrets({ [key]: opts.api_key });
    process.env[key] = opts.api_key;
  }
  const state: ProviderState = {
    name: opts.name,
    connected: true,
    auth: opts.auth,
    validated_at: new Date().toISOString(),
    error: null,
  };
  saveState(state);
  return state;
}
