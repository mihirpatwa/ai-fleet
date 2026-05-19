'use client';
// Settings. Theme + Notifications are client stores (apply instantly). The
// daemon-backed sections (Models, Concurrency, Cost caps, Memory) persist via
// PUT /api/config; the daemon reports which changed keys need a restart and we
// surface that as a banner. Security/retention knobs that aren't part of the
// daemon config yet are shown disabled rather than faked.
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Alert,
  App,
  Button,
  Card,
  InputNumber,
  Segmented,
  Select,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { AGENTS } from '@/lib/agents';
import { roleColor } from '@/lib/theme';
import {
  groupByTier,
  ctxLabel,
  priceLabel,
  jsonFetcher,
  type ActiveModels,
  type ModelInfo,
} from '@/lib/models';
import { useTheme, type ThemeMode } from '@/lib/stores/useTheme';
import { useSettings, NOTIFICATION_TYPES } from '@/lib/stores/useSettings';

const { Text, Title } = Typography;

interface DaemonConfig {
  max_concurrent_agents: number;
  cost_cap_per_hour_usd: number;
  per_agent_hourly_cap: number;
  per_task_cap_usd: number;
  memory: { shadow_runs: number };
}

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function SettingsView() {
  const { message } = App.useApp();
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const notify = useSettings((s) => s.notify);
  const setNotify = useSettings((s) => s.setNotify);

  const { data: config, mutate: mutateConfig } = useSWR<DaemonConfig>('/api/config', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: models } = useSWR<ModelInfo[]>('/api/models', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: active, mutate: mutateActive } = useSWR<ActiveModels>(
    '/api/models/active',
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const [draft, setDraft] = useState<DaemonConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [restartKeys, setRestartKeys] = useState<string[]>([]);
  useEffect(() => {
    if (config && !draft) setDraft(config);
  }, [config, draft]);

  const modelOptions = groupByTier(models ?? []).map((g) => ({
    label: g.tier,
    title: g.tier,
    options: g.models.map((m) => ({
      value: m.id,
      label: `${m.display_name} — ${ctxLabel(m.context_window)}, ${priceLabel(m.pricing)}`,
    })),
  }));

  async function putAgentModel(agent: string, modelId: string): Promise<void> {
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
      await mutateActive();
      message.success(`${agent} → ${modelId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function refreshModels(): Promise<void> {
    await fetch('/api/models/refresh', { method: 'POST' });
    message.success('Model list refreshed');
  }

  async function saveDaemon(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          max_concurrent_agents: draft.max_concurrent_agents,
          cost_cap_per_hour_usd: draft.cost_cap_per_hour_usd,
          per_agent_hourly_cap: draft.per_agent_hourly_cap,
          per_task_cap_usd: draft.per_task_cap_usd,
          memory: { shadow_runs: draft.memory.shadow_runs },
        }),
      });
      const body = (await res.json()) as { error?: string; restartNeeded?: string[] };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setRestartKeys(body.restartNeeded ?? []);
      await mutateConfig();
      message.success('Settings saved');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const agentCols: ColumnsType<{ agent: string }> = [
    {
      title: 'Agent',
      dataIndex: 'agent',
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
    },
    {
      title: 'Model',
      key: 'model',
      render: (_, r) => (
        <Select
          style={{ width: 280 }}
          size="small"
          loading={!models || !active}
          value={active?.per_agent?.[r.agent]}
          placeholder={active ? `Default (${active.default})` : 'Default'}
          options={modelOptions}
          onChange={(v) => putAgentModel(r.agent, v)}
          showSearch
          optionFilterProp="label"
        />
      ),
    },
    {
      title: '',
      key: 'reset',
      render: (_, r) => (
        <Button
          size="small"
          disabled={!active || active.per_agent?.[r.agent] === undefined}
          onClick={() => active && putAgentModel(r.agent, active.default)}
        >
          Reset to default
        </Button>
      ),
    },
  ];

  const section = (title: string, extra: React.ReactNode, body: React.ReactNode) => (
    <Card size="small" title={title} extra={extra} style={{ marginBottom: 16 }}>
      {body}
    </Card>
  );

  return (
    <div style={{ maxWidth: 900 }}>
      <Title level={4}>Settings</Title>

      {restartKeys.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Restart required"
          description={`These changes apply after a daemon restart: ${restartKeys.join(', ')}.`}
        />
      )}

      {section(
        'Theme',
        null,
        <Segmented<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]}
        />,
      )}

      {section(
        'Models',
        <Button size="small" icon={<ReloadOutlined />} onClick={refreshModels}>
          Refresh list
        </Button>,
        <Table
          rowKey="agent"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={agentCols}
          dataSource={AGENTS.map((a) => ({ agent: a }))}
        />,
      )}

      {section(
        'Concurrency',
        null,
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">Max concurrent agents (restart required to take full effect)</Text>
          <Slider
            min={1}
            max={10}
            value={draft?.max_concurrent_agents ?? 3}
            onChange={(v) =>
              setDraft((d) => (d ? { ...d, max_concurrent_agents: v } : d))
            }
          />
        </Space>,
      )}

      {section(
        'Cost caps (USD)',
        null,
        <Space size="large" wrap>
          {(
            [
              ['Per hour', 'cost_cap_per_hour_usd'],
              ['Per agent / hour', 'per_agent_hourly_cap'],
              ['Per task', 'per_task_cap_usd'],
            ] as const
          ).map(([label, key]) => (
            <Space key={key} direction="vertical" size={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {label}
              </Text>
              <InputNumber
                min={0}
                step={0.1}
                prefix="$"
                value={draft?.[key] ?? 0}
                onChange={(v) =>
                  setDraft((d) => (d ? { ...d, [key]: Number(v ?? 0) } : d))
                }
              />
            </Space>
          ))}
        </Space>,
      )}

      {section(
        'Notifications',
        null,
        <Space direction="vertical">
          <Text type="secondary" style={{ fontSize: 12 }}>
            Which alerts to surface (toast delivery wires up in phase 12b).
          </Text>
          {NOTIFICATION_TYPES.map((n) => (
            <Space key={n.key}>
              <Switch
                size="small"
                checked={notify[n.key]}
                onChange={(c) => setNotify(n.key, c)}
              />
              <Text>{n.label}</Text>
            </Space>
          ))}
        </Space>,
      )}

      {section(
        'Memory',
        null,
        <Space direction="vertical">
          <Text type="secondary" style={{ fontSize: 12 }}>
            Shadow runs — low-confidence retrospect runs kept out of the hot tier.
          </Text>
          <InputNumber
            min={0}
            value={draft?.memory.shadow_runs ?? 10}
            onChange={(v) =>
              setDraft((d) => (d ? { ...d, memory: { shadow_runs: Number(v ?? 0) } } : d))
            }
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Retention days — not a daemon config key yet (planned).
          </Text>
          <InputNumber disabled placeholder="—" />
        </Space>,
      )}

      {section(
        'Security',
        null,
        <Space direction="vertical">
          <Space>
            <Switch size="small" disabled />
            <Text type="secondary">
              Require security pass — per-project (.aifleet policy), not a global setting yet.
            </Text>
          </Space>
          <Space>
            <InputNumber disabled placeholder="—" />
            <Text type="secondary">Audit log retention — planned.</Text>
          </Space>
        </Space>,
      )}

      <Button type="primary" loading={saving} disabled={!draft} onClick={saveDaemon}>
        Save daemon settings
      </Button>
      <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
        Theme + notifications save automatically.
      </Text>
    </div>
  );
}
