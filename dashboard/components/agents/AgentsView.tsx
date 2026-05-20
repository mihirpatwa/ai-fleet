'use client';
// Agent roster (shadcn cards → Antd Table) with a per-agent Model column.
// The Select placeholder is the global default; choosing a model persists an
// override via PUT /api/models/agent/:agent.
import useSWR from 'swr';
import { App, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AgentSummary } from '@/lib/types';
import { roleColor } from '@/lib/theme';
import { ago } from '@/lib/format';
import { groupByTier, ctxLabel, priceLabel, jsonFetcher, type ActiveModels, type ModelInfo } from '@/lib/models';

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function AgentsView({ rows }: { rows: AgentSummary[] }) {
  const { message } = App.useApp();
  const { data: models } = useSWR<ModelInfo[]>('/api/models', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: active, mutate } = useSWR<ActiveModels>('/api/models/active', jsonFetcher, {
    revalidateOnFocus: false,
  });

  const modelOptions = groupByTier(models ?? []).map((g) => ({
    label: g.tier,
    title: g.tier,
    options: g.models.map((m) => ({
      value: m.id,
      label: `${m.display_name} — ${ctxLabel(m.context_window)}, ${priceLabel(m.pricing)}`,
    })),
  }));

  async function setModel(agent: string, modelId: string): Promise<void> {
    try {
      const res = await fetch(`/api/models/agent/${encodeURIComponent(agent)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Request failed (${res.status})`);
      }
      await mutate();
      message.success(`${agent} → ${modelId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

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
    {
      title: 'Model',
      key: 'model',
      width: 280,
      render: (_, r) => (
        <Select
          style={{ width: 260 }}
          size="small"
          loading={!models || !active}
          value={active?.per_agent?.[r.agent]}
          placeholder={active ? `Default (${active.default})` : 'Default'}
          options={modelOptions}
          onChange={(v) => setModel(r.agent, v)}
          showSearch
          optionFilterProp="label"
        />
      ),
    },
  ];

  return (
    <Table<AgentSummary>
      rowKey="agent"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: 'No agent activity yet.' }}
    />
  );
}
