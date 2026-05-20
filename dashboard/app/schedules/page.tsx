// r5: Schedules page. Client-side fetch + CRUD via /api/schedules so the
// dashboard reflects daemon mutations immediately.
import { Section } from '@/components/Shell/Section';
import { SchedulesView } from '@/components/schedules/SchedulesView';

export const dynamic = 'force-dynamic';

export default function SchedulesPage() {
  return (
    <Section title="Scheduled tasks" breadcrumb={[{ title: 'Schedules' }]}>
      <SchedulesView />
    </Section>
  );
}
