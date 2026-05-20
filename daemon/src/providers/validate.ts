// Phase 18: per-provider credential validation.
//
// Each provider exposes a cheap "is this key good?" probe so the connect
// modal can verify before the user is dropped into the dashboard. For Claude
// we hit /v1/models — a lightweight call that 401s immediately on a bad key.
// `local` auth probes filesystem signals Claude Code drops on login (r8) so
// the user gets an explicit error before the first spawn fails.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AuthMethod, ProviderName } from './types.js';

const ANTHROPIC_VERSION = '2023-06-01';

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

/** r8: probe for files Claude Code drops after `claude /login` so the connect
 *  modal can refuse "local" auth when the user isn't actually logged in. We
 *  accept any of three known locations the CLI has used. */
function hasClaudeCodeLogin(): boolean {
  const candidates = [
    join(homedir(), '.claude', '.credentials.json'),
    join(homedir(), '.claude.json'),
    join(homedir(), '.config', 'claude', '.credentials.json'),
  ];
  return candidates.some((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

async function validateClaude(auth: AuthMethod, key?: string): Promise<ValidateResult> {
  if (auth === 'local') {
    if (!hasClaudeCodeLogin()) {
      return {
        ok: false,
        error:
          'Claude Code credentials not found — run `claude /login` in a terminal first.',
      };
    }
    return { ok: true };
  }
  if (!key) return { ok: false, error: 'api_key required' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'API key rejected by Anthropic (401/403)' };
    }
    if (!res.ok) return { ok: false, error: `Anthropic returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

export async function validateProvider(
  name: ProviderName,
  auth: AuthMethod,
  key?: string,
): Promise<ValidateResult> {
  if (name === 'claude') return validateClaude(auth, key);
  // codex stub — kept for parity but the registry marks it unavailable.
  return { ok: false, error: `${name} not implemented yet` };
}
