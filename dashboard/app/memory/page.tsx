// Adaptive memory (server component). Reads lib/db; filters via ?query.
import { listMemoriesDash, memoryAgents, memoryProjects } from '@/lib/db';
import { getActiveProject } from '@/lib/activeProject';
import { Section } from '@/components/Shell/Section';
import { MemoryView } from '@/components/memory/MemoryView';

export const dynamic = 'force-dynamic';

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; agent?: string; tag?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const project = await getActiveProject(sp.project, undefined);
  const rows = listMemoriesDash({
    ...(project ? { project } : {}),
    ...(sp.agent ? { agent: sp.agent } : {}),
    ...(sp.tag ? { tag: sp.tag } : {}),
    ...(sp.q ? { q: sp.q } : {}),
    sort: 'confidence',
    dir: 'desc',
  });

  return (
    <Section
      title="Adaptive memory"
      subtitle={`${rows.length} lesson${rows.length === 1 ? '' : 's'}`}
      breadcrumb={[{ title: 'Memory' }]}
    >
      <MemoryView rows={rows} projects={memoryProjects()} agents={memoryAgents()} sp={sp} />
    </Section>
  );
}
