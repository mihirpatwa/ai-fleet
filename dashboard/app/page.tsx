// Kanban board (server component). Data path unchanged from v1: read the
// daemon's SQLite directly via lib/db.ts, filter by ?project/?root/?agent,
// then hand serializable data to the Antd <Board> client component. Live
// refresh still arrives via the shared SSE stream (<Live/> in AppShell).
import { listTasks, goals, latestTool, lastLog, projects } from '@/lib/db';
import { getActiveProject } from '@/lib/activeProject';
import { Board } from '@/components/board/Board';

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; root?: string; agent?: string }>;
}) {
  const sp = await searchParams;
  const all = projects();
  const project = await getActiveProject(sp.project, all[0]);

  // Root tasks only — children (e.g. the retrospector that auto-spawns after
  // every root) shouldn't double up cards on the board. Their work shows up
  // inside the task detail tree.
  const tasks = listTasks({
    ...(project ? { project } : {}),
    ...(sp.root ? { root: sp.root } : {}),
    ...(sp.agent ? { agent: sp.agent } : {}),
  }).filter((t) => t.parentId === null);

  const cards = tasks.map((task) => ({
    task,
    tool: latestTool(task.id),
    log: lastLog(task.id),
  }));

  const goalOptions = goals(project).map((g) => ({ id: g.id, title: g.title }));
  // Agents in the filter come from the root tasks we actually show, so the
  // dropdown can never list an agent that would yield an empty board.
  const agents = [...new Set(tasks.map((t) => t.assignedAgent))].sort();

  return <Board cards={cards} goals={goalOptions} agents={agents} />;
}
