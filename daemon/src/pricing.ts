// Per-model token pricing. Numbers are USD per *million* tokens, matching
// Anthropic's published API price sheet for the Claude 4 family
// (https://www.anthropic.com/pricing — standard ≤200K context tier):
//
//   model            input   output   cache read (5m/1h hit)
//   Sonnet 4.x        $3.00   $15.00   $0.30
//   Opus 4.x         $15.00   $75.00   $1.50
//   Haiku 4.x         $1.00    $5.00   $0.10
//
// `computeCost` reports cost from the published rate sheet rather than the
// SDK's `total_cost_usd` so cost accounting stays deterministic and offline.

export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read (cached input) tokens. */
  cacheRead: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

const SONNET_4: ModelPricing = { input: 3.0, output: 15.0, cacheRead: 0.3 };
const OPUS_4: ModelPricing = { input: 15.0, output: 75.0, cacheRead: 1.5 };
const HAIKU_4: ModelPricing = { input: 1.0, output: 5.0, cacheRead: 0.1 };

/**
 * Exact model id → pricing, kept in sync with Anthropic's public price sheet.
 * Covers every id in the daemon's bundled model registry (models.ts); the
 * family fallbacks below still price any newer point release sensibly while
 * the WARN (see {@link hasExactPricing}) nudges an operator to add it here.
 */
export const PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-4-7': OPUS_4,
  'claude-opus-4-6': OPUS_4,
  'claude-sonnet-4-6': SONNET_4,
  'claude-sonnet-4-5': SONNET_4,
  'claude-haiku-4-5': HAIKU_4,
};

/** True only for an exact price-sheet entry (family fallback does NOT count). */
export function hasExactPricing(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICING, model);
}

// Prefix fallbacks so a future point release (claude-sonnet-4-7, …) or an
// alias still prices correctly instead of silently costing $0.
const FAMILY_FALLBACKS: ReadonlyArray<readonly [RegExp, ModelPricing]> = [
  [/opus/i, OPUS_4],
  [/sonnet/i, SONNET_4],
  [/haiku/i, HAIKU_4],
];

/** Resolve pricing for a model id, or `undefined` if it matches no known family. */
export function getPricing(model: string): ModelPricing | undefined {
  const exact = PRICING[model];
  if (exact) return exact;
  for (const [re, pricing] of FAMILY_FALLBACKS) {
    if (re.test(model)) return pricing;
  }
  return undefined;
}

/**
 * USD cost of one model call. Unknown models price at $0 — the caller is
 * expected to fall back to the SDK-reported cost in that case. Rounded to
 * 1e-9 to strip IEEE-754 noise from sub-cent sums.
 */
export function computeCost(model: string, usage: TokenUsage): number {
  const p = getPricing(model);
  if (!p) return 0;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const usd = (input * p.input + output * p.output + cacheRead * p.cacheRead) / 1_000_000;
  return Math.round(usd * 1e9) / 1e9;
}
