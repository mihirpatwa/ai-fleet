// Phase 18: per-provider credential validation.
//
// Each provider exposes a cheap "is this key good?" probe so the connect
// modal can verify before the user is dropped into the dashboard. For Claude
// we hit /v1/models — a lightweight call that 401s immediately on a bad key.
// `local` auth (Claude Code logged-in subscription) can't be validated from
// here; we assume it works and rely on the first spawn to surface errors.
import type { AuthMethod, ProviderName } from './types.js';

const ANTHROPIC_VERSION = '2023-06-01';

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

async function validateClaude(auth: AuthMethod, key?: string): Promise<ValidateResult> {
  if (auth === 'local') {
    // We can't reach Claude Code's local credentials from the daemon process
    // without spawning the CLI. Defer to the first spawn — return ok.
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
  // codex/openai stubs — kept for parity but the registry marks them unavailable.
  return { ok: false, error: `${name} not implemented yet` };
}
