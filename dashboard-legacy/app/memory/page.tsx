import Link from 'next/link';
import { listMemoriesDash, memoryAgents, memoryProjects } from '@/lib/db';
import { ago } from '@/lib/format';
import { roleClasses } from '@/lib/roles';
import { Badge } from '@/components/ui/badge';
import { MemoryActions } from '@/components/memory-actions';

export const dynamic = 'force-dynamic';

type SP = {
  project?: string;
  agent?: string;
  tag?: string;
  sort?: 'confidence' | 'used' | 'recent';
  dir?: 'asc' | 'desc';
};

export default async function MemoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sort = sp.sort ?? 'confidence';
  const dir = sp.dir ?? 'desc';
  const rows = listMemoriesDash({
    ...(sp.project ? { project: sp.project } : {}),
    ...(sp.agent ? { agent: sp.agent } : {}),
    ...(sp.tag ? { tag: sp.tag } : {}),
    sort,
    dir,
  });
  const projects = memoryProjects();
  const agents = memoryAgents();

  const sortHref = (col: SP['sort']): string => {
    const nextDir = sort === col && dir === 'desc' ? 'asc' : 'desc';
    const p = new URLSearchParams({
      ...(sp.project ? { project: sp.project } : {}),
      ...(sp.agent ? { agent: sp.agent } : {}),
      ...(sp.tag ? { tag: sp.tag } : {}),
      sort: col ?? 'confidence',
      dir: nextDir,
    });
    return `?${p}`;
  };
  const arrow = (col: SP['sort']): string => (sort === col ? (dir === 'desc' ? ' ↓' : ' ↑') : '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Adaptive memory</h1>
        <span className="text-sm text-muted-foreground">{rows.length} lesson(s)</span>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-3 text-sm">
        <select
          name="project"
          defaultValue={sp.project ?? ''}
          className="h-9 rounded-md border bg-transparent px-2"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          name="agent"
          defaultValue={sp.agent ?? ''}
          className="h-9 rounded-md border bg-transparent px-2"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          name="tag"
          defaultValue={sp.tag ?? ''}
          placeholder="tag"
          className="h-9 w-32 rounded-md border bg-transparent px-2 outline-none"
        />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <button className="h-9 rounded-md border px-3 hover:bg-muted">Filter</button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No memories yet. Lessons appear after the retrospector runs.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="p-2">Agent</th>
                <th className="p-2">Tags</th>
                <th className="p-2">Context</th>
                <th className="p-2">
                  <Link href={sortHref('confidence')}>conf{arrow('confidence')}</Link>
                </th>
                <th className="p-2">
                  <Link href={sortHref('used')}>used{arrow('used')}</Link>
                </th>
                <th className="p-2">
                  <Link href={sortHref('recent')}>created{arrow('recent')}</Link>
                </th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b last:border-0 align-top">
                  <td className="p-2">
                    <Badge variant="outline" className={roleClasses(m.agent ?? '')}>
                      {m.agent ?? 'project'}
                    </Badge>
                  </td>
                  <td className="p-2 font-mono text-xs text-muted-foreground">
                    {m.tags.join(', ')}
                  </td>
                  <td className="max-w-md p-2" title={JSON.stringify(m.lesson)}>
                    <span className="line-clamp-2">{m.context ?? '—'}</span>
                  </td>
                  <td className="p-2">{m.confidence.toFixed(2)}</td>
                  <td className="p-2">{m.usedCount}</td>
                  <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">
                    {ago(m.createdAt)}
                  </td>
                  <td className="p-2">
                    <MemoryActions id={m.id} pinned={m.pinned} lesson={m.lesson} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
