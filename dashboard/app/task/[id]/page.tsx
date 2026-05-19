// Task detail (server component). Same SSR data path as v1 — read the daemon's
// SQLite directly — then hand serializable data to the Antd <TaskDetail>. Live
// updates arrive via the shared SSE refresh (<Live/> in AppShell) re-running
// this server component, so Logs/Tree/Metrics stay fresh with no polling.
import { notFound } from 'next/navigation';
import { getTask, listEvents, taskMetrics, taskSubtree } from '@/lib/db';
import { TaskDetail } from '@/components/task/TaskDetail';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) notFound();

  const parent = task.parentId ? getTask(task.parentId) : null;
  const events = listEvents(task.id);
  const tree = taskSubtree(task);
  const metrics = taskMetrics(task);

  return (
    <TaskDetail
      task={task}
      parent={parent ? { id: parent.id, title: parent.title } : null}
      events={events}
      tree={tree}
      metrics={metrics}
    />
  );
}
