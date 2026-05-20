'use client';
// Adaptive memory table. project/agent/tag/q are server filters (push to
// ?query, lib/db refilters); confidence/used/created sort client-side via
// Table sorters. r6 added the matching filter bar; t14 adds row selection
// with bulk pin + bulk delete actions.
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  App,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface';
import {
  ClearOutlined,
  DeleteOutlined,
  PushpinOutlined,
} from '@ant-design/icons';
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

  // t14: row-level bulk actions. Selection state is local; actions iterate
  // the existing per-row endpoints in parallel so we don't add a daemon
  // surface for bulk operations the user can already do one by one.
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function bulkPin(pinned: boolean): Promise<void> {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        selected.map((id) =>
          fetch(`/api/memory/${id}/pin`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pinned }),
          }),
        ),
      );
      message.success(`${pinned ? 'Pinned' : 'Unpinned'} ${selected.length}`);
      setSelected([]);
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'bulk pin failed');
    } finally {
      setBusy(false);
    }
  }
  async function bulkDelete(): Promise<void> {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        selected.map((id) => fetch(`/api/memory/${id}`, { method: 'DELETE' })),
      );
      message.success(`Deleted ${selected.length}`);
      setSelected([]);
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'bulk delete failed');
    } finally {
      setBusy(false);
    }
  }

  const rowSelection: TableRowSelection<Memory> = {
    selectedRowKeys: selected,
    onChange: (keys) => setSelected(keys.map(String)),
    preserveSelectedRowKeys: true,
  };

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
      {selected.length > 0 && (
        <Space style={{ marginBottom: 12 }}>
          <Typography.Text strong>{selected.length} selected</Typography.Text>
          <Button
            size="small"
            icon={<PushpinOutlined />}
            loading={busy}
            onClick={() => void bulkPin(true)}
          >
            Pin
          </Button>
          <Button
            size="small"
            icon={<PushpinOutlined />}
            loading={busy}
            onClick={() => void bulkPin(false)}
          >
            Unpin
          </Button>
          <Popconfirm
            title={`Delete ${selected.length} memor${selected.length === 1 ? 'y' : 'ies'}?`}
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => void bulkDelete()}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={busy}>
              Delete
            </Button>
          </Popconfirm>
          <Button size="small" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </Space>
      )}
      <Table<Memory>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        rowSelection={rowSelection}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No memories yet. Lessons appear after the retrospector runs.' }}
      />
    </>
  );
}
