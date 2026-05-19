// Token & cost usage (server component). Reads agent_runs via lib/db.
import { costBreakdown, costTotals } from '@/lib/db';
import { Section } from '@/components/Shell/Section';
import { CostView } from '@/components/cost/CostView';

export const dynamic = 'force-dynamic';

export default function CostPage() {
  return (
    <Section title="Token & cost usage" breadcrumb={[{ title: 'Cost' }]}>
      <CostView
        data={{
          totals: costTotals(),
          byAgent: costBreakdown('agent'),
          byModel: costBreakdown('model'),
          byDay: costBreakdown('day'),
        }}
      />
    </Section>
  );
}
