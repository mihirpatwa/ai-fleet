import Link from 'next/link';
import { goals, projects } from '@/lib/db';
import { ago, elapsed } from '@/lib/format';
import { statusClasses, roleClasses } from '@/lib/roles';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const project = sp.project ?? projects()[0];
  const roots = goals(project);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Goals</h1>
      {roots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No goals submitted yet.</p>
      ) : (
        roots.map((g) => (
          <Link key={g.id} href={`/task/${g.id}`} className="block">
            <Card className="flex flex-row flex-wrap items-center gap-3 p-3 hover:border-ring">
              <Badge variant="outline" className={statusClasses(g.status)}>
                {g.status}
              </Badge>
              <Badge variant="outline" className={roleClasses(g.assignedAgent)}>
                {g.assignedAgent}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-medium" title={g.title}>
                {g.title}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{g.projectRoot}</span>
              <span className="text-xs text-muted-foreground">
                created {ago(g.createdAt)} · {elapsed(g.startedAt, g.finishedAt)}
              </span>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
