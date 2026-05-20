// Goals = root tasks (server component). Reads lib/db; filters from URL.
import { goals, projects } from '@/lib/db';
import { getActiveProject } from '@/lib/activeProject';
import { Section } from '@/components/Shell/Section';
import { GoalsView } from '@/components/goals/GoalsView';

export const dynamic = 'force-dynamic';

interface GoalsQuery {
  project?: string;
  all?: string;
  status?: string;
  agent?: string;
  q?: string;
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<GoalsQuery>;
}) {
  const sp = await searchParams;
  const allProjects = projects();
  const showAll = sp.all === '1';
  const project = showAll ? undefined : await getActiveProject(sp.project, allProjects[0]);

  // Pull root tasks then narrow with the in-URL filters. The data set is
  // bounded (root tasks across all projects), so client-side narrowing isn't
  // worth the SSR/CSR split here.
  let rows = goals(project);
  if (sp.status) rows = rows.filter((t) => t.status === sp.status);
  if (sp.agent) rows = rows.filter((t) => t.assignedAgent === sp.agent);
  if (sp.q) {
    const q = sp.q.toLowerCase();
    rows = rows.filter((t) => t.title.toLowerCase().includes(q));
  }

  // Per-filter option lists come from the unfiltered set so a chosen value
  // doesn't disappear from its own dropdown.
  const baseline = goals(project);
  const agentOpts = [...new Set(baseline.map((t) => t.assignedAgent))].sort();
  const statusOpts = [...new Set(baseline.map((t) => t.status))].sort();

  return (
    <Section
      title="Goals"
      subtitle={showAll ? `All projects · ${allProjects.length} total` : (project ?? undefined)}
      breadcrumb={[{ title: 'Goals' }]}
    >
      <GoalsView
        rows={rows}
        projects={allProjects}
        agents={agentOpts}
        statuses={statusOpts}
        active={{
          all: showAll,
          ...(project ? { project } : {}),
          ...(sp.status ? { status: sp.status } : {}),
          ...(sp.agent ? { agent: sp.agent } : {}),
          ...(sp.q ? { q: sp.q } : {}),
        }}
      />
    </Section>
  );
}
