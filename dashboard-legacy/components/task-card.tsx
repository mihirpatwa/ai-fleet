import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { Task } from '@/lib/types';
import { roleClasses } from '@/lib/roles';
import { elapsed, truncate } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export interface CardData {
  task: Task;
  tool: string | null;
  log: string | null;
}

export function TaskCard({ task, tool, log }: CardData) {
  return (
    <Link href={`/task/${task.id}`} className="block">
      <Card className="gap-2 p-3 transition-colors hover:border-ring">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={roleClasses(task.assignedAgent)}>
            {task.assignedAgent}
          </Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {elapsed(task.startedAt, task.finishedAt)}
          </span>
        </div>

        <p className="truncate text-sm font-medium" title={task.title}>
          {task.title}
        </p>

        {tool && <p className="truncate text-xs text-muted-foreground italic">using {tool}</p>}

        <Progress value={task.progress} className="h-1.5" />

        {log && (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={log}>
            {truncate(log, 90)}
          </p>
        )}
      </Card>
    </Link>
  );
}
