'use client';
// Adaptive memory table. Native table + GET form → Antd Table + Select/Input
// filters. project/agent/tag are server filters (push to ?query, lib/db
// refilters); confidence/used/created sort client-side via Table sorters.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Memory } from '@/lib/types';
import { roleColor } from '@/lib/theme';
import { ago, parseTs, pretty } from '@/lib/format';
import { MemoryActions } from './MemoryActions';

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function MemoryView({
  rows,
  projects,
  agents,
  sp,
}: {
  rows: Memory[];
  projects: string[];
  agents: string[];
  sp: { project?: string; agent?: string; tag?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setFilter(key: string, value?: string): void {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    router.push(`${pathname}?${q.toString()}`);
  }

  const columns: ColumnsType<Memory> = [
    {
      title: 'Agent',
      dataIndex: 'agent',
      render: (a: string | null) => (
        <Tag style={tint(roleColor(a ?? ''))}>{a ?? 'project'}</Tag>
      ),
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      render: (t: string[]) => (
        <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {t.join(', ')}
        </Typography.Text>
      ),
    },
    {
      title: 'Context',
      dataIndex: 'context',
      render: (c: string | null, r) => (
        <Typography.Text
          style={{ maxWidth: 420 }}
          ellipsis={{ tooltip: pretty(r.lesson) }}
        >
          {c ?? '—'}
        </Typography.Text>
      ),
    },
    {
      title: 'Conf',
      dataIndex: 'confidence',
      sorter: (a, b) => a.confidence - b.confidence,
      defaultSortOrder: 'descend',
      render: (n: number) => n.toFixed(2),
    },
    {
      title: 'Used',
      dataIndex: 'usedCount',
      sorter: (a, b) => a.usedCount - b.usedCount,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      sorter: (a, b) =>
        (parseTs(a.createdAt)?.getTime() ?? 0) - (parseTs(b.createdAt)?.getTime() ?? 0),
      render: (_: string, r) => ago(r.createdAt),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, r) => <MemoryActions id={r.id} pinned={r.pinned} lesson={r.lesson} />,
    },
  ];

  return (
    <>
      <Space wrap size={12} style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="All projects"
          style={{ minWidth: 200 }}
          value={sp.project || undefined}
          onChange={(v?: string) => setFilter('project', v)}
          options={projects.map((p) => ({ value: p, label: p }))}
        />
        <Select
          allowClear
          placeholder="All agents"
          style={{ minWidth: 160 }}
          value={sp.agent || undefined}
          onChange={(v?: string) => setFilter('agent', v)}
          options={agents.map((a) => ({ value: a, label: a }))}
        />
        <Input.Search
          placeholder="tag"
          defaultValue={sp.tag ?? ''}
          allowClear
          style={{ width: 160 }}
          onSearch={(v) => setFilter('tag', v || undefined)}
        />
      </Space>
      <Table<Memory>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No memories yet. Lessons appear after the retrospector runs.' }}
      />
    </>
  );
}
