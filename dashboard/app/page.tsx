import { listTasks, goals, latestTool, lastLog, projects } from '@/lib/db';
import type { Task } from '@/lib/types';
import { FilterBar } from '@/components/filter-bar';
import { TaskCard } from '@/components/task-card';

export const dynamic = 'force-dynamic';

const COLUMNS: { name: string; has: (s: Task['status']) => boolean }[] = [
  { name: 'Backlog', has: (s) => s === 'queued' },
  { name: 'In progress', has: (s) => s === 'running' },
  { name: 'Review', has: (s) => s === 'review' },
  { name: 'Blocked', has: (s) => s === 'blocked' },
  { name: 'Done', has: (s) => s === 'done' || s === 'failed' || s === 'cancelled' },
];

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; root?: string; agent?: string }>;
}) {
  const sp = await searchParams;
  const all = projects();
  const project = sp.project ?? all[0];

  const tasks = listTasks({
    ...(project ? { project } : {}),
    ...(sp.root ? { root: sp.root } : {}),
    ...(sp.agent ? { agent: sp.agent } : {}),
  });
  const cards = tasks.map((task) => ({
    task,
    tool: latestTool(task.id),
    log: lastLog(task.id),
  }));

  const goalOptions = goals(project).map((g) => ({ id: g.id, title: g.title }));
  const agents = [
    ...new Set(listTasks(project ? { project } : {}).map((t) => t.assignedAgent)),
  ].sort();

  return (
    <div>
      <FilterBar goals={goalOptions} agents={agents} />

      {tasks.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">
          No tasks yet. Submit a goal from the top bar to get started.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = cards.filter((c) => col.has(c.task.status));
            return (
              <section key={col.name} className="flex flex-col rounded-lg border bg-card/40">
                <header className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
                  <span>{col.name}</span>
                  <span className="text-muted-foreground">{items.length}</span>
                </header>
                <div className="flex max-h-[calc(100vh-15rem)] flex-col gap-2 overflow-y-auto p-2">
                  {items.map((c) => (
                    <TaskCard key={c.task.id} task={c.task} tool={c.tool} log={c.log} />
                  ))}
                  {items.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">Empty</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
