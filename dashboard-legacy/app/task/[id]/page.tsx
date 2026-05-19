import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { getTask, listEvents, taskMetrics, taskSubtree } from '@/lib/db';
import { roleClasses, statusClasses } from '@/lib/roles';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TaskActions } from '@/components/task-actions';
import { TaskTabs } from '@/components/task-tabs';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) notFound();

  const parent = task.parentId ? getTask(task.parentId) : null;
  const isRoot = task.rootId === task.id;
  const events = listEvents(task.id);
  const tree = taskSubtree(task);
  const metrics = taskMetrics(task);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          Board
        </Link>
        <ChevronRight className="size-3" />
        {!isRoot && (
          <>
            <Link href={`/task/${task.rootId}`} className="hover:underline">
              root
            </Link>
            <ChevronRight className="size-3" />
          </>
        )}
        {parent && (
          <>
            <Link href={`/task/${parent.id}`} className="hover:underline" title={parent.title}>
              {parent.title.length > 40 ? parent.title.slice(0, 39) + '…' : parent.title}
            </Link>
            <ChevronRight className="size-3" />
          </>
        )}
        <span className="text-foreground">{task.id}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">{task.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={roleClasses(task.assignedAgent)}>
              {task.assignedAgent}
            </Badge>
            <Badge variant="outline" className={statusClasses(task.status)}>
              {task.status}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{task.projectRoot}</span>
          </div>
          {task.error && <p className="text-sm text-red-500">{task.error}</p>}
        </div>
        <TaskActions id={task.id} status={task.status} />
      </div>

      <Separator />

      <TaskTabs events={events} tree={tree} metrics={metrics} output={task.outputJson} />
    </div>
  );
}
