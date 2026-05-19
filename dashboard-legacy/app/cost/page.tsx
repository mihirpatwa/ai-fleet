import { costBreakdown, costTotals } from '@/lib/db';
import { compact, usd } from '@/lib/format';
import { Card } from '@/components/ui/card';
import type { CostRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

function BarList({ title, rows }: { title: string; rows: CostRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.costUsd));
  return (
    <Card className="gap-3 p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="truncate font-mono" title={r.key}>
                  {r.key}
                </span>
                <span className="text-muted-foreground">
                  {usd(r.costUsd)} · {compact(r.inputTokens)} in / {compact(r.outputTokens)} out
                </span>
              </div>
              <div className="h-2 rounded bg-muted">
                <div
                  className="h-2 rounded bg-primary"
                  style={{ width: `${(r.costUsd / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function CostPage() {
  const totals = costTotals();
  const byAgent = costBreakdown('agent');
  const byModel = costBreakdown('model');
  const byDay = costBreakdown('day');

  const stats = [
    ['Total cost', usd(totals.costUsd)],
    ['Input tokens', compact(totals.inputTokens)],
    ['Output tokens', compact(totals.outputTokens)],
    ['Cached tokens', compact(totals.cacheReadTokens)],
    ['Agent runs', String(totals.runs)],
  ] as const;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Token &amp; cost usage</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <Card key={label} className="gap-1 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <BarList title="By agent" rows={byAgent} />
        <BarList title="By model" rows={byModel} />
        <BarList title="By day" rows={byDay} />
      </div>
    </div>
  );
}
