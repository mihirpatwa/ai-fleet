'use client';
// Root tasks (one per submitted goal). shadcn cards → Antd Table.
import Link from 'next/link';
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Task } from '@/lib/types';
import { roleColor, statusColor } from '@/lib/theme';
import { ago, elapsed } from '@/lib/format';

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function GoalsView({ rows }: { rows: Task[] }) {
  const columns: ColumnsType<Task> = [
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: string) => <Tag style={tint(statusColor(s))}>{s}</Tag>,
    },
    {
      title: 'Agent',
      dataIndex: 'assignedAgent',
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
    },
    {
      title: 'Goal',
      dataIndex: 'title',
      render: (t: string, r) => <Link href={`/task/${r.id}`}>{t}</Link>,
    },
    {
      title: 'Project',
      dataIndex: 'projectRoot',
      render: (p: string) => (
        <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {p}
        </Typography.Text>
      ),
    },
    { title: 'Created', key: 'created', render: (_, r) => ago(r.createdAt) },
    {
      title: 'Elapsed',
      key: 'elapsed',
      render: (_, r) => elapsed(r.startedAt, r.finishedAt),
    },
  ];

  return (
    <Table<Task>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: 'No goals submitted yet.' }}
    />
  );
}
