// Phase 18f: adaptive model selection. Goal modal exposes an "Adaptive" pseudo-
// model; when the SDK request for a task carries that sentinel we pick a real
// model on the fly based on (1) the agent's role and (2) a cheap complexity
// score from the task title. No extra LLM call — just heuristics. Defaults
// bias toward cost-efficient choices and upgrade only when warranted.

import type { FleetConfig } from '../config.js';

/** Sentinel used as `model_override` to mean "pick for me". */
export const ADAPTIVE_SENTINEL = '__adaptive__';

export function isAdaptive(override: string | null | undefined): boolean {
  return override === ADAPTIVE_SENTINEL;
}

// Role → tier defaults. "tier" is later mapped to an actual model id via the
// fleet config (model_selection.default / .orchestrator) and a few stable
// known-good Haiku/Opus ids — those exist in models.ts BUNDLED.
type Tier = 'haiku' | 'sonnet' | 'opus';
const ROLE_TIER: Record<string, Tier> = {
  orchestrator: 'opus',
  planner: 'opus',
  coder: 'sonnet',
  reviewer: 'sonnet',
  'security-auditor': 'sonnet',
  tester: 'sonnet',
  devops: 'sonnet',
  'frontend-architect': 'opus',
  'a11y-auditor': 'sonnet',
  researcher: 'haiku',
  scribe: 'haiku',
  retrospector: 'haiku',
  debugger: 'sonnet',
  'doc-writer': 'haiku',
};

type ComplexitySignal = 'upgrade' | 'downgrade' | 'keep';

/** Detect upgrade/downgrade signals from the task title alone. The length
 *  component only contributes to upgrade — short titles don't automatically
 *  downgrade since most real goals are short. Easy-verb regex is the only
 *  trigger for downgrade, so the default tier wins unless we're confident
 *  the work is trivial. */
function complexitySignal(title: string): ComplexitySignal {
  const hardWords =
    /\b(refactor|migrate|architecture|design|audit|review|investigate|root[- ]?cause|optimi[sz]e|debug|race|deadlock|memory leak|performance|benchmark|remediation)\b/i;
  const easyWords =
    /\b(rename|fix typo|add log|update copy|format|lint|comment|reword|tweak copy)\b/i;
  const longEnough = title.length >= 200;
  if (easyWords.test(title)) return 'downgrade';
  if (hardWords.test(title) || longEnough) return 'upgrade';
  return 'keep';
}

function upgrade(t: Tier): Tier {
  return t === 'haiku' ? 'sonnet' : 'opus';
}
function downgrade(t: Tier): Tier {
  return t === 'opus' ? 'sonnet' : 'haiku';
}

/** Map a tier to a real model id, preferring values from config so the user's
 *  Settings choices for default/orchestrator are honoured. Haiku falls back
 *  to a known-good bundled id. */
function tierToModel(tier: Tier, config: FleetConfig): string {
  const ms = config.model_selection;
  if (tier === 'opus') return ms.orchestrator;
  if (tier === 'sonnet') return ms.default;
  // No Haiku slot in config; use a known-good id from the bundled registry.
  return 'claude-haiku-4-5';
}

/**
 * Pick a real model id for a (agent, title) pair when the user requested
 * adaptive selection. Pure function: just (config, agent, title) → model id.
 */
export function pickAdaptiveModel(
  config: FleetConfig,
  agent: string,
  title: string,
): string {
  let tier: Tier = ROLE_TIER[agent] ?? 'sonnet';
  const signal = complexitySignal(title);
  if (signal === 'upgrade') tier = upgrade(tier);
  else if (signal === 'downgrade') tier = downgrade(tier);
  return tierToModel(tier, config);
}
