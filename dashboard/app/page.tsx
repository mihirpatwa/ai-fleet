// Kanban board (server component). Data path unchanged from v1: read the
// daemon's SQLite directly via lib/db.ts, filter by ?project/?root/?agent,
// then hand serializable data to the Antd <Board> client component. Live
// refresh still arrives via the shared SSE stream (<Live/> in AppShell).
import { listTasks, goals, latestTool, lastLog, projects } from '@/lib/db';
import { Board } from '@/components/board/Board';

export const dynamic = 'force-dynamic';

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

  return <Board cards={cards} goals={goalOptions} agents={agents} />;
}
