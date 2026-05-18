import Link from 'next/link';
import { projects, securityFindings } from '@/lib/db';
import type { Severity } from '@/lib/types';
import { ago } from '@/lib/format';
import { severityClasses } from '@/lib/roles';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const SEVERITIES: Severity[] = ['critical', 'high', 'med', 'low'];

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; severity?: string }>;
}) {
  const sp = await searchParams;
  const project = sp.project ?? projects()[0];
  const all = securityFindings(project);
  const active = SEVERITIES.includes(sp.severity as Severity) ? (sp.severity as Severity) : null;
  const shown = active ? all.filter((f) => f.severity === active) : all;

  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, all.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;
  const blocking = all.filter(
    (f) => f.blocking && (f.severity === 'high' || f.severity === 'critical'),
  ).length;
  const qs = (sev: string | null): string =>
    `?${new URLSearchParams({ ...(project ? { project } : {}), ...(sev ? { severity: sev } : {}) })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Security findings</h1>
        <span className="text-sm text-muted-foreground">
          {all.length} finding(s) · {blocking} blocking
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href={qs(null)}
          className={`rounded-md border px-3 py-1 ${active === null ? 'bg-muted' : ''}`}
        >
          All ({all.length})
        </Link>
        {SEVERITIES.map((s) => (
          <Link
            key={s}
            href={qs(s)}
            className={`rounded-md border px-3 py-1 ${active === s ? 'bg-muted' : ''}`}
          >
            <Badge variant="outline" className={severityClasses(s)}>
              {s}
            </Badge>{' '}
            {counts[s]}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {active ?? ''} findings. The security-auditor reports here after it runs.
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((f, i) => (
            <Card key={`${f.taskId}-${i}`} className="gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={severityClasses(f.severity)}>
                  {f.severity}
                </Badge>
                {f.blocking && (
                  <Badge variant="outline" className={severityClasses('high')}>
                    blocking
                  </Badge>
                )}
                <span className="font-mono text-xs">{f.rule}</span>
                <span className="ml-auto text-xs text-muted-foreground">{ago(f.ts)}</span>
              </div>
              <p className="text-sm">{f.message}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {f.file}
                {f.line != null ? `:${f.line}` : ''}
              </p>
              {f.fixHint && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Fix: </span>
                  {f.fixHint}
                </p>
              )}
              <Link
                href={`/task/${f.taskId}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                audit task {f.taskId} · {f.projectRoot}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
