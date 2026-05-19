'use client';
// Security findings. shadcn cards → Antd Table, default-sorted by severity
// rank (critical→low). Segmented filter narrows by severity client-side
// (rows are already loaded).
import { useState } from 'react';
import Link from 'next/link';
import { Segmented, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SecurityFinding, Severity } from '@/lib/types';
import { severityColor } from '@/lib/theme';
import { ago } from '@/lib/format';

const SEVERITIES: Severity[] = ['critical', 'high', 'med', 'low'];
const RANK: Record<Severity, number> = { critical: 0, high: 1, med: 2, low: 3 };

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function SecurityView({ findings }: { findings: SecurityFinding[] }) {
  const [sev, setSev] = useState<'all' | Severity>('all');
  const shown = sev === 'all' ? findings : findings.filter((f) => f.severity === sev);
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;

  const columns: ColumnsType<SecurityFinding> = [
    {
      title: 'Severity',
      dataIndex: 'severity',
      defaultSortOrder: 'ascend',
      sorter: (a, b) => RANK[a.severity] - RANK[b.severity],
      render: (s: Severity, r) => (
        <Space size={4}>
          <Tag style={tint(severityColor(s))}>{s}</Tag>
          {r.blocking && <Tag color="red">blocking</Tag>}
        </Space>
      ),
    },
    {
      title: 'Rule',
      dataIndex: 'rule',
      render: (v: string) => (
        <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Typography.Text>
      ),
    },
    {
      title: 'Location',
      key: 'loc',
      render: (_, f) => (
        <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {f.file}
          {f.line != null ? `:${f.line}` : ''}
        </Typography.Text>
      ),
    },
    { title: 'Message', dataIndex: 'message', render: (m: string) => <span>{m}</span> },
    {
      title: 'Fix',
      dataIndex: 'fixHint',
      render: (h: string | null) =>
        h ? (
          <Typography.Text type="secondary">{h}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: 'When', key: 'ts', render: (_, f) => ago(f.ts) },
    {
      title: 'Task',
      key: 'task',
      render: (_, f) => <Link href={`/task/${f.taskId}`}>{f.taskId.slice(0, 8)}…</Link>,
    },
  ];

  return (
    <>
      <Segmented
        style={{ marginBottom: 16 }}
        value={sev}
        onChange={(v) => setSev(v as 'all' | Severity)}
        options={[
          { label: `All (${findings.length})`, value: 'all' },
          ...SEVERITIES.map((s) => ({ label: `${s} (${counts[s]})`, value: s })),
        ]}
      />
      <Table<SecurityFinding>
        rowKey={(f) => `${f.taskId}-${f.file}-${f.line}-${f.rule}`}
        size="small"
        columns={columns}
        dataSource={shown}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: 'No findings. The security-auditor reports here after it runs.',
        }}
      />
    </>
  );
}
