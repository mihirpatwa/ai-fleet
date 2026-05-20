// Phase 10 scheduler readout. Read-only — toggling cron rows from the UI is
// a future surface; today the daemon seeds defaults and runs them.
import { listScheduledTasks } from '@/lib/db';
import { Section } from '@/components/Shell/Section';
import { SchedulesView } from '@/components/schedules/SchedulesView';

export const dynamic = 'force-dynamic';

export default function SchedulesPage() {
  const rows = listScheduledTasks();
  return (
    <Section
      title="Scheduled tasks"
      subtitle={`${rows.length} cron job${rows.length === 1 ? '' : 's'}`}
      breadcrumb={[{ title: 'Schedules' }]}
    >
      <SchedulesView rows={rows} />
    </Section>
  );
}
