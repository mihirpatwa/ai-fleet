'use client';
// Settings. Theme is a client store (applies instantly). Daemon-backed sections
// (Default model, Per-agent models, Concurrency, Cost caps, Memory) persist via
// PUT /api/config or PUT /api/models/agent/*; the daemon reports which changed
// keys need a restart and we surface that as a banner. Security/retention knobs
// not yet wired to the daemon are shown disabled rather than faked.
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

const { Text, Title, Paragraph } = Typography;

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

// Section wrapper: title row + muted one-line *what & why*. Card stays
// uniform across the page so every setting reads the same way.
function Section({
  title,
  hint,
  extra,
  children,
}: {
  title: string;
  hint?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text strong>{title}</Text>
          {hint && (
            <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
              {hint}
            </Text>
          )}
        </div>
      }
      extra={extra}
      style={{ marginBottom: 16 }}
    >
      {children}
    </Card>
  );
}

function ModifiedTag({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <Tag color="gold" style={{ marginLeft: 8 }}>
      modified
    </Tag>
  );
}

export function SettingsView() {
  const { message } = App.useApp();
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);

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
    void mutateActive();
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

  function resetDraft(): void {
    if (config) setDraft(config);
    setRestartKeys([]);
  }

  // Compare draft vs persisted to drive the "modified" tag + Save enable.
  const modifiedKeys = (() => {
    if (!draft || !config) return new Set<keyof DaemonConfig | 'memory.shadow_runs'>();
    const m = new Set<keyof DaemonConfig | 'memory.shadow_runs'>();
    (['max_concurrent_agents', 'cost_cap_per_hour_usd', 'per_agent_hourly_cap', 'per_task_cap_usd'] as const).forEach((k) => {
      if (draft[k] !== config[k]) m.add(k);
    });
    if (draft.memory.shadow_runs !== config.memory.shadow_runs) m.add('memory.shadow_runs');
    return m;
  })();
  const dirty = modifiedKeys.size > 0;

  const agentCols: ColumnsType<{ agent: string }> = [
    {
      title: 'Agent',
      dataIndex: 'agent',
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
      width: 160,
    },
    {
      title: 'Model',
      key: 'model',
      render: (_, r) => {
        const override = active?.per_agent?.[r.agent];
        return (
          <Space>
            <Select
              style={{ width: 320 }}
              size="small"
              loading={!models || !active}
              value={override}
              placeholder={active ? `Default — ${active.default}` : 'Default'}
              options={modelOptions}
              onChange={(v) => putAgentModel(r.agent, v)}
              showSearch
              optionFilterProp="label"
              allowClear={!!override}
            />
            {override ? <Tag color="gold">override</Tag> : <Tag>using default</Tag>}
          </Space>
        );
      },
    },
    {
      title: '',
      key: 'reset',
      width: 140,
      render: (_, r) => (
        <Button
          size="small"
          disabled={!active || active.per_agent?.[r.agent] === undefined}
          onClick={() => active && putAgentModel(r.agent, active.default)}
        >
          Reset
        </Button>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 960, paddingBottom: 80 }}>
      <Title level={4}>Settings</Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Theme applies instantly. All other settings persist to{' '}
        <Text code>~/.aifleet/config.yaml</Text>; some keys require a daemon
        restart (you&apos;ll see a banner).
      </Paragraph>

      {restartKeys.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Restart required"
          description={`Daemon must restart for: ${restartKeys.join(', ')}.`}
        />
      )}

      <Section title="Theme" hint="Affects only your browser. Stored in localStorage.">
        <Segmented<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]}
        />
      </Section>

      <Section
        title="Default model"
        hint="Used for every goal that doesn't override the model in the New goal form."
      >
        <Space wrap>
          <Select
            style={{ width: 360 }}
            value={active?.default}
            loading={!models || !active}
            options={modelOptions}
            onChange={(v) => putAgentModel('default', v)}
            showSearch
            optionFilterProp="label"
          />
          {active?.default && <Tag color="blue">{active.default}</Tag>}
        </Space>
      </Section>

      <Section
        title="Per-agent models"
        hint="Override the default for specific agents — e.g. orchestrator on Opus for planning, coder on Sonnet for cost."
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={refreshModels}>
            Refresh list
          </Button>
        }
      >
        <Table
          rowKey="agent"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={agentCols}
          dataSource={AGENTS.map((a) => ({ agent: a }))}
        />
      </Section>

      <Section
        title={`Concurrency${modifiedKeys.has('max_concurrent_agents') ? ' •' : ''}`}
        hint="Max agents running simultaneously. Higher = faster throughput but higher $/h."
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Text>Max concurrent agents</Text>
            <Tag>current: {config?.max_concurrent_agents ?? '—'}</Tag>
            <ModifiedTag on={modifiedKeys.has('max_concurrent_agents')} />
          </Space>
          <Slider
            min={1}
            max={10}
            marks={{ 1: '1', 3: '3', 5: '5', 10: '10' }}
            value={draft?.max_concurrent_agents ?? 3}
            onChange={(v) =>
              setDraft((d) => (d ? { ...d, max_concurrent_agents: v } : d))
            }
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Restart required for new value to take effect.
          </Text>
        </Space>
      </Section>

      <Section
        title="Cost caps (USD)"
        hint="Hard limits. Daemon blocks new agent spawns once any cap is exceeded."
      >
        <Space size="large" wrap>
          {(
            [
              ['Per hour', 'cost_cap_per_hour_usd', 'Total across all agents.'],
              ['Per agent / hour', 'per_agent_hourly_cap', 'Stops a single agent from running away.'],
              ['Per task', 'per_task_cap_usd', 'Absolute ceiling for one goal.'],
            ] as const
          ).map(([label, key, hint]) => (
            <Space key={key} direction="vertical" size={2} style={{ minWidth: 180 }}>
              <Space size={4}>
                <Text strong style={{ fontSize: 12 }}>
                  {label}
                </Text>
                <ModifiedTag on={modifiedKeys.has(key)} />
              </Space>
              <InputNumber
                min={0}
                step={0.1}
                prefix="$"
                style={{ width: 140 }}
                value={draft?.[key] ?? 0}
                onChange={(v) =>
                  setDraft((d) => (d ? { ...d, [key]: Number(v ?? 0) } : d))
                }
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {hint}
              </Text>
            </Space>
          ))}
        </Space>
      </Section>

      <Section
        title="Memory"
        hint="Adaptive memory: lessons from prior runs are stored, ranked, and surfaced to future agents."
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Text>Shadow runs</Text>
            <Tag>current: {config?.memory.shadow_runs ?? '—'}</Tag>
            <ModifiedTag on={modifiedKeys.has('memory.shadow_runs')} />
          </Space>
          <InputNumber
            min={0}
            value={draft?.memory.shadow_runs ?? 10}
            onChange={(v) =>
              setDraft((d) => (d ? { ...d, memory: { shadow_runs: Number(v ?? 0) } } : d))
            }
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            New projects keep their first N retrospect runs out of the hot tier
            (low-confidence period). 10 is the recommended default.
          </Text>
          <div style={{ marginTop: 12 }}>
            <Space>
              <InputNumber disabled placeholder="—" />
              <Text type="secondary">Retention days — planned.</Text>
            </Space>
          </div>
        </Space>
      </Section>

      <Section
        title="Security"
        hint="Path sandbox lives in ~/.aifleet/config.yaml. Per-project policies override these globally."
      >
        <Space direction="vertical">
          <Space>
            <Switch size="small" disabled />
            <Text type="secondary">
              Require security pass — set per-project (.aifleet policy), not yet
              a global toggle.
            </Text>
          </Space>
          <Space>
            <InputNumber disabled placeholder="—" />
            <Text type="secondary">Audit log retention — planned.</Text>
          </Space>
        </Space>
      </Section>

      {/* Sticky save bar */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          marginTop: 16,
          padding: '12px 16px',
          background: 'var(--ant-color-bg-container, #fff)',
          borderTop: '1px solid rgba(128,128,128,0.18)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'flex-end',
          zIndex: 5,
        }}
      >
        <Text type="secondary" style={{ marginRight: 'auto', fontSize: 12 }}>
          {dirty
            ? `${modifiedKeys.size} unsaved change${modifiedKeys.size === 1 ? '' : 's'}`
            : 'All daemon settings up to date.'}
        </Text>
        <Button onClick={resetDraft} disabled={!dirty}>
          Discard
        </Button>
        <Button type="primary" loading={saving} disabled={!draft || !dirty} onClick={saveDaemon}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
