'use client';
// Goals — root tasks across project(s). Filter bar mirrors filter state into
// the URL so back/forward + page reload preserve the view; "All projects"
// strips the project filter entirely so the user can compare across roots.
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClearOutlined } from '@ant-design/icons';
import type { Task } from '@/lib/types';
import { roleColor, statusColor } from '@/lib/theme';
import { ago, elapsed } from '@/lib/format';

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export interface GoalsActive {
  all: boolean;
  project?: string;
  status?: string;
  agent?: string;
  q?: string;
}

export function GoalsView({
  rows,
  projects,
  agents,
  statuses,
  active,
}: {
  rows: Task[];
  projects: string[];
  agents: string[];
  statuses: string[];
  active: GoalsActive;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setParam(key: string, value: string | null): void {
    const next = new URLSearchParams(sp.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearAll(): void {
    router.push(pathname);
  }

  const columns: ColumnsType<Task> = [
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (s: string) => <Tag style={tint(statusColor(s))}>{s}</Tag>,
    },
    {
      title: 'Agent',
      dataIndex: 'assignedAgent',
      width: 140,
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
    },
    {
      title: 'Goal',
      dataIndex: 'title',
      render: (t: string, r) => (
        <Link href={`/task/${r.id}`} style={{ wordBreak: 'break-word' }}>
          {t}
        </Link>
      ),
    },
    {
      title: 'Project',
      dataIndex: 'projectRoot',
      width: 260,
      render: (p: string) => (
        <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {p}
        </Typography.Text>
      ),
    },
    { title: 'Created', key: 'created', width: 110, render: (_, r) => ago(r.createdAt) },
    {
      title: 'Elapsed',
      key: 'elapsed',
      width: 100,
      render: (_, r) => elapsed(r.startedAt, r.finishedAt),
    },
  ];

  const filtersActive = Boolean(
    active.status || active.agent || active.q || active.all,
  );

  return (
    <div>
      <Space wrap style={{ marginBottom: 16, width: '100%' }} size={[12, 8]}>
        <Segmented
          value={active.all ? 'all' : 'current'}
          onChange={(v) => setParam('all', v === 'all' ? '1' : null)}
          options={[
            { label: 'Current project', value: 'current' },
            { label: 'All projects', value: 'all' },
          ]}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 160 }}
          value={active.status}
          onChange={(v) => setParam('status', v ?? null)}
          options={statuses.map((s) => ({ value: s, label: s }))}
        />
        <Select
          allowClear
          placeholder="Agent"
          style={{ width: 200 }}
          value={active.agent}
          onChange={(v) => setParam('agent', v ?? null)}
          options={agents.map((a) => ({ value: a, label: a }))}
        />
        <Input.Search
          allowClear
          placeholder="Search title…"
          style={{ width: 260 }}
          defaultValue={active.q}
          onSearch={(v) => setParam('q', v.trim() || null)}
        />
        <Button icon={<ClearOutlined />} disabled={!filtersActive} onClick={clearAll}>
          Clear
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {rows.length} goal{rows.length === 1 ? '' : 's'}
          {active.all
            ? ` across ${projects.length} project${projects.length === 1 ? '' : 's'}`
            : ''}
        </Typography.Text>
      </Space>

      <Table<Task>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No goals match your filters.' }}
      />
    </div>
  );
}
