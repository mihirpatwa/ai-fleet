// Adaptive memory (server component). Reads lib/db; filters via ?query.
import { listMemoriesDash, memoryAgents, memoryProjects } from '@/lib/db';
import { Section } from '@/components/Shell/Section';
import { MemoryView } from '@/components/memory/MemoryView';

export const dynamic = 'force-dynamic';

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; agent?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const rows = listMemoriesDash({
    ...(sp.project ? { project: sp.project } : {}),
    ...(sp.agent ? { agent: sp.agent } : {}),
    ...(sp.tag ? { tag: sp.tag } : {}),
    sort: 'confidence',
    dir: 'desc',
  });

  return (
    <Section
      title="Adaptive memory"
      subtitle={`${rows.length} lesson(s)`}
      breadcrumb={[{ title: 'Memory' }]}
    >
      <MemoryView rows={rows} projects={memoryProjects()} agents={memoryAgents()} sp={sp} />
    </Section>
  );
}
