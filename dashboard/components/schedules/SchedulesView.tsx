'use client';
// Phase 10 cron scheduler readout. The daemon evaluates `scheduled_tasks`
// every minute (UTC) and materializes a regular task per due row. This view
// is read-only — toggling rows is a deeper UI surface we haven't built yet.
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ScheduledTask } from '@/lib/db';
import { roleColor } from '@/lib/theme';
import { ago } from '@/lib/format';

const { Text } = Typography;

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function SchedulesView({ rows }: { rows: ScheduledTask[] }) {
  const columns: ColumnsType<ScheduledTask> = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (n: string) => <Text strong>{n}</Text>,
    },
    {
      title: 'Cron (UTC)',
      dataIndex: 'cron',
      render: (c: string) => <Text code>{c}</Text>,
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
    },
    {
      title: 'Project',
      dataIndex: 'project_root',
      render: (p: string | null) =>
        p ? (
          <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {p}
          </Text>
        ) : (
          <Text type="secondary">(global)</Text>
        ),
    },
    {
      title: 'Last run',
      dataIndex: 'last_run_at',
      render: (t: string | null) => (t ? ago(t) : <Text type="secondary">—</Text>),
    },
    {
      title: 'Next run',
      dataIndex: 'next_run_at',
      render: (t: string | null) => (t ? ago(t) : <Text type="secondary">—</Text>),
    },
    {
      title: 'State',
      dataIndex: 'enabled',
      render: (e: boolean) => (e ? <Tag color="green">enabled</Tag> : <Tag>disabled</Tag>),
    },
  ];

  return (
    <Table<ScheduledTask>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: 'max-content' }}
      locale={{
        emptyText:
          'No scheduled tasks yet. The daemon seeds three defaults (scribe-daily, memory-compact-weekly, deps-audit-daily) on first boot — wait a few seconds and refresh.',
      }}
    />
  );
}
