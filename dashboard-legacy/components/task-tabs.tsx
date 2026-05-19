'use client';

import Link from 'next/link';
import type { FleetEvent, TaskMetrics, TaskNode } from '@/lib/types';
import { compact, pretty, usd } from '@/lib/format';
import { statusClasses } from '@/lib/roles';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

function EventRow({ e }: { e: FleetEvent }) {
  const isTool = e.type === 'tool_use_pre' || e.type === 'tool_use_post';
  return (
    <li className="border-l-2 border-border pl-3 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="font-mono">{e.ts}</span>
        <span className="font-medium text-foreground">{e.type}</span>
        {e.agent && <span>· {e.agent}</span>}
      </div>
      {e.payloadJson != null && (
        <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">
          {isTool ? pretty(e.payloadJson) : pretty(e.payloadJson)}
        </pre>
      )}
    </li>
  );
}

function TreeNode({ node, depth = 0 }: { node: TaskNode; depth?: number }) {
  return (
    <li>
      <div className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 16 }}>
        <Badge variant="outline" className={statusClasses(node.status)}>
          {node.status}
        </Badge>
        <Link href={`/task/${node.id}`} className="truncate hover:underline" title={node.title}>
          {node.title}
        </Link>
        <span className="text-xs text-muted-foreground">{node.assignedAgent}</span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export function TaskTabs({
  events,
  tree,
  metrics,
  output,
}: {
  events: FleetEvent[];
  tree: TaskNode | null;
  metrics: TaskMetrics;
  output: unknown;
}) {
  return (
    <Tabs defaultValue="log" className="w-full">
      <TabsList>
        <TabsTrigger value="log">Log</TabsTrigger>
        <TabsTrigger value="tree">Tree</TabsTrigger>
        <TabsTrigger value="metrics">Metrics</TabsTrigger>
        <TabsTrigger value="output">Output</TabsTrigger>
      </TabsList>

      <TabsContent value="log">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="tree">
        {tree ? (
          <ul>
            <TreeNode node={tree} />
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No subtasks.</p>
        )}
      </TabsContent>

      <TabsContent value="metrics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Input tokens" value={compact(metrics.inputTokens)} />
          <Stat label="Output tokens" value={compact(metrics.outputTokens)} />
          <Stat label="Cached tokens" value={compact(metrics.cacheReadTokens)} />
          <Stat label="Cost" value={usd(metrics.costUsd)} />
          <Stat
            label="Duration"
            value={metrics.durationMs == null ? '—' : `${Math.round(metrics.durationMs / 1000)}s`}
          />
          <Stat label="Retries" value={String(metrics.retries)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{metrics.runs} agent run(s) recorded.</p>
      </TabsContent>

      <TabsContent value="output">
        {output == null ? (
          <p className="text-sm text-muted-foreground">No structured output.</p>
        ) : (
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">
            {pretty(output)}
          </pre>
        )}
      </TabsContent>
    </Tabs>
  );
}
