// Agent roster (server component). Reads the daemon's SQLite via lib/db like
// the board; the per-agent Model column is wired client-side in <AgentsView>.
import { agentSummaries, projects } from '@/lib/db';
import { getActiveProject } from '@/lib/activeProject';
import { Section } from '@/components/Shell/Section';
import { AgentsView } from '@/components/agents/AgentsView';

export const dynamic = 'force-dynamic';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const project = await getActiveProject(sp.project, projects()[0]);
  const rows = agentSummaries(project);

  return (
    <Section
      title="Agent roster"
      subtitle={project ?? undefined}
      breadcrumb={[{ title: 'Agents' }]}
    >
      <AgentsView rows={rows} />
    </Section>
  );
}
