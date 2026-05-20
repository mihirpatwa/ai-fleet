'use client';
// Adaptive memory table. project/agent/tag/q are server filters (push to
// ?query, lib/db refilters); confidence/used/created sort client-side via
// Table sorters. r6: matches the Goals filter bar — adds a free-text search
// + Clear button + count summary.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClearOutlined } from '@ant-design/icons';
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
  sp: { project?: string; agent?: string; tag?: string; q?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setFilter(key: string, value?: string): void {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    const qs = q.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
  function clearAll(): void {
    router.push(pathname);
  }
  const filtersActive = Boolean(sp.project || sp.agent || sp.tag || sp.q);

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
      <Space wrap size={[12, 8]} style={{ marginBottom: 16, width: '100%' }}>
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
          placeholder="Tag"
          defaultValue={sp.tag ?? ''}
          allowClear
          style={{ width: 160 }}
          onSearch={(v) => setFilter('tag', v || undefined)}
        />
        <Input.Search
          placeholder="Search lesson/context…"
          defaultValue={sp.q ?? ''}
          allowClear
          style={{ width: 240 }}
          onSearch={(v) => setFilter('q', v.trim() || undefined)}
        />
        <Button icon={<ClearOutlined />} disabled={!filtersActive} onClick={clearAll}>
          Clear
        </Button>
        <Typography.Text type="secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {rows.length} lesson{rows.length === 1 ? '' : 's'}
        </Typography.Text>
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
