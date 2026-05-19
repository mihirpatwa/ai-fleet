import { agentSummaries, projects } from '@/lib/db';
import { ago, usd } from '@/lib/format';
import { roleClasses } from '@/lib/roles';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const project = sp.project ?? projects()[0];
  const rows = agentSummaries(project);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Agent roster</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agent activity yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => (
            <Card key={a.agent} className="gap-2 p-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={roleClasses(a.agent)}>
                  {a.agent}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {a.running > 0 ? 'active' : 'idle'} · {ago(a.lastActivity)}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-sm">
                <div>
                  <div className="font-semibold text-sky-500">{a.running}</div>
                  <div className="text-xs text-muted-foreground">running</div>
                </div>
                <div>
                  <div className="font-semibold">{a.queued}</div>
                  <div className="text-xs text-muted-foreground">queued</div>
                </div>
                <div>
                  <div className="font-semibold text-emerald-500">{a.done}</div>
                  <div className="text-xs text-muted-foreground">done</div>
                </div>
                <div>
                  <div className="font-semibold text-red-500">{a.failed}</div>
                  <div className="text-xs text-muted-foreground">failed</div>
                </div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{a.total} task(s)</span>
                <span>{usd(a.costUsd)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
