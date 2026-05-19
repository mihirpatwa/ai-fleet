'use client';
// shadcn Tabs → Antd Tabs. Order is fixed by the phase-12 spec: Logs, Code,
// Flow, Tree, Metrics, Output. Active tab syncs to ?tab= so a reload keeps the
// selection; Antd Tabs scrolls its bar horizontally on overflow (mobile).
// Code + Flow are wired live in phase 12b — placeholders for now.
import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, Col, Empty, Row, Statistic, Tabs, Tag, Typography } from 'antd';
import type { FleetEvent, TaskMetrics, TaskNode } from '@/lib/types';
import { compact, pretty, usd } from '@/lib/format';
import { statusColor } from '@/lib/theme';

const { Text } = Typography;

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

function EventRow({ e }: { e: FleetEvent }) {
  return (
    <li
      style={{
        borderLeft: '2px solid rgba(128,128,128,0.25)',
        paddingLeft: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
        <Text type="secondary" style={{ fontFamily: 'monospace' }}>
          {e.ts}
        </Text>
        <Text strong>{e.type}</Text>
        {e.agent && <Text type="secondary">· {e.agent}</Text>}
      </div>
      {e.payloadJson != null && (
        <pre
          style={{
            margin: '4px 0 0',
            padding: 8,
            borderRadius: 6,
            background: 'rgba(128,128,128,0.12)',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {pretty(e.payloadJson)}
        </pre>
      )}
    </li>
  );
}

function TreeNode({ node, depth = 0 }: { node: TaskNode; depth?: number }) {
  return (
    <li style={{ listStyle: 'none' }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '4px 0',
          paddingLeft: depth * 16,
        }}
      >
        <Tag style={tint(statusColor(node.status))}>{node.status}</Tag>
        <Link href={`/task/${node.id}`}>{node.title}</Link>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {node.assignedAgent}
        </Text>
      </div>
      {node.children.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 0 }}>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get('tab') ?? 'logs';

  const onChange = useCallback(
    (key: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set('tab', key);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const placeholder = (what: string) => (
    <Empty
      description={`${what} is wired live in phase 12b`}
      style={{ padding: '48px 0' }}
    />
  );

  const items = [
    {
      key: 'logs',
      label: 'Logs',
      children:
        events.length === 0 ? (
          <Empty description="No events yet." style={{ padding: '48px 0' }} />
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        ),
    },
    { key: 'code', label: 'Code', children: placeholder('The Monaco diff view') },
    { key: 'flow', label: 'Flow', children: placeholder('The React Flow DAG') },
    {
      key: 'tree',
      label: 'Tree',
      children: tree ? (
        <ul style={{ margin: 0, padding: 0 }}>
          <TreeNode node={tree} />
        </ul>
      ) : (
        <Empty description="No subtasks." style={{ padding: '48px 0' }} />
      ),
    },
    {
      key: 'metrics',
      label: 'Metrics',
      children: (
        <>
          <Row gutter={[16, 16]}>
            {[
              { label: 'Input tokens', value: compact(metrics.inputTokens) },
              { label: 'Output tokens', value: compact(metrics.outputTokens) },
              { label: 'Cached tokens', value: compact(metrics.cacheReadTokens) },
              { label: 'Cost', value: usd(metrics.costUsd) },
              {
                label: 'Duration',
                value:
                  metrics.durationMs == null
                    ? '—'
                    : `${Math.round(metrics.durationMs / 1000)}s`,
              },
              { label: 'Retries', value: String(metrics.retries) },
            ].map((s) => (
              <Col xs={12} sm={8} md={6} key={s.label}>
                <Card size="small">
                  <Statistic title={s.label} value={s.value} />
                </Card>
              </Col>
            ))}
          </Row>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            {metrics.runs} agent run(s) recorded.
          </Text>
        </>
      ),
    },
    {
      key: 'output',
      label: 'Output',
      children:
        output == null ? (
          <Empty description="No structured output." style={{ padding: '48px 0' }} />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.2)',
              background: 'rgba(128,128,128,0.08)',
              fontSize: 12,
              overflowX: 'auto',
            }}
          >
            {pretty(output)}
          </pre>
        ),
    },
  ];

  return <Tabs activeKey={active} onChange={onChange} items={items} />;
}
