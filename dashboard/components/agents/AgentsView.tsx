'use client';
// Agent roster (shadcn cards → Antd Table). Phase 18 dropped the per-agent
// Model column; every agent uses the global default model (or orchestrator's
// model for orchestrator). Override is per-task on the New goal modal.
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AgentSummary } from '@/lib/types';
import { roleColor } from '@/lib/theme';
import { ago } from '@/lib/format';

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function AgentsView({ rows }: { rows: AgentSummary[] }) {
  const columns: ColumnsType<AgentSummary> = [
    {
      title: 'Agent',
      dataIndex: 'agent',
      fixed: 'left',
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
    },
    {
      title: 'State',
      key: 'state',
      render: (_, r) => (
        <Typography.Text type="secondary">
          {r.running > 0 ? 'active' : 'idle'} · {ago(r.lastActivity)}
        </Typography.Text>
      ),
    },
    { title: 'Running', dataIndex: 'running', align: 'right' },
    { title: 'Queued', dataIndex: 'queued', align: 'right' },
    { title: 'Done', dataIndex: 'done', align: 'right' },
    { title: 'Failed', dataIndex: 'failed', align: 'right' },
    { title: 'Total', dataIndex: 'total', align: 'right' },
  ];

  return (
    <Table<AgentSummary>
      rowKey="agent"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: 'max-content' }}
      locale={{
        emptyText:
          'No agent activity yet. Counts populate after the first goal runs against this project.',
      }}
    />
  );
}
