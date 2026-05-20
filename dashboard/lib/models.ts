// Shared client-side model helpers (SubmitGoal modal, /agents, /settings).
// Mirrors the daemon's GET /models / /models/active shapes.
export interface ModelInfo {
  id: string;
  display_name: string;
  context_window: number;
  pricing: { input_per_mtok: number; output_per_mtok: number; cache_read: number } | null;
  recommended_for: string[];
}

export interface ActiveModels {
  default: string;
  orchestrator: string;
  per_agent: Record<string, string>;
  per_task_allow_override: boolean;
}

export const jsonFetcher = <T>(url: string): Promise<T> => fetch(url).then((r) => r.json());

export type Tier = 'Opus' | 'Sonnet' | 'Haiku' | 'Other';

export function tierOf(m: ModelInfo): Tier {
  const s = `${m.id} ${m.display_name}`.toLowerCase();
  if (s.includes('opus')) return 'Opus';
  if (s.includes('sonnet')) return 'Sonnet';
  if (s.includes('haiku')) return 'Haiku';
  return 'Other';
}

export function ctxLabel(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M ctx` : `${Math.round(n / 1000)}K ctx`;
}

export function priceLabel(p: ModelInfo['pricing']): string {
  if (!p) return 'price n/a';
  return `$${p.input_per_mtok}/$${p.output_per_mtok} per Mtok`;
}

const TIER_ORDER: Tier[] = ['Opus', 'Sonnet', 'Haiku', 'Other'];

/** Antd Select option groups by tier; caller supplies the per-option render. */
export function groupByTier(models: ModelInfo[]): { tier: Tier; models: ModelInfo[] }[] {
  const by = new Map<Tier, ModelInfo[]>();
  for (const m of models) {
    const t = tierOf(m);
    (by.get(t) ?? by.set(t, []).get(t)!).push(m);
  }
  return TIER_ORDER.filter((t) => by.has(t)).map((tier) => ({ tier, models: by.get(tier)! }));
}
