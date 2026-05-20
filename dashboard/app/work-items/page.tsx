// Phase 18g: Azure work items route. Client-side everything (the daemon is
// the only thing talking to Azure; the dashboard just proxies + renders).
import { Section } from '@/components/Shell/Section';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';

export const dynamic = 'force-dynamic';

export default function WorkItemsPage() {
  return (
    <Section title="Work items" breadcrumb={[{ title: 'Work items' }]}>
      <WorkItemsView />
    </Section>
  );
}
