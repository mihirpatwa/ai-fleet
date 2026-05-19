// Goals = root tasks (server component). Reads the daemon's SQLite via lib/db.
import { goals, projects } from '@/lib/db';
import { Section } from '@/components/Shell/Section';
import { GoalsView } from '@/components/goals/GoalsView';

export const dynamic = 'force-dynamic';

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const project = sp.project ?? projects()[0];
  const roots = goals(project);

  return (
    <Section
      title="Goals"
      subtitle={project ?? undefined}
      breadcrumb={[{ title: 'Goals' }]}
    >
      <GoalsView rows={roots} />
    </Section>
  );
}
