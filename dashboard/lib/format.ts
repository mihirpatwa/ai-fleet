// Small presentation helpers. The daemon stores timestamps as UTC
// `YYYY-MM-DD HH:MM:SS` (no zone) — parse them as UTC, not local.
//
// (date-fns is intentionally not used: under Next 15's strict tsc + "bundler"
// module resolution its v4 type entry doesn't resolve cleanly, and the only
// thing needed here is a compact single-unit duration — a few lines below.)

export function parseTs(ts: string | null): Date | null {
  if (!ts) return null;
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Compact single-unit duration, e.g. 800ms→"1s", 90s→"1m", 3700s→"1h". */
export function humanizeMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Elapsed wall time: started→finished, or started→now while live. */
export function elapsed(startedAt: string | null, finishedAt: string | null): string {
  const start = parseTs(startedAt);
  if (!start) return '—';
  const end = parseTs(finishedAt) ?? new Date();
  return humanizeMs(end.getTime() - start.getTime());
}

export function ago(ts: string | null): string {
  const d = parseTs(ts);
  return d ? `${humanizeMs(Date.now() - d.getTime())} ago` : '—';
}

export function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function usd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function compact(n: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
