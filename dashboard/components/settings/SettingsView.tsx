'use client';
// Settings. Theme is a client store (applies instantly). Daemon-backed sections
// (Default model, Concurrency, Memory) persist via PUT /api/config or
// /api/models/agent/default; the daemon reports which changed keys need a
// restart and we surface that as a banner. Security/retention knobs not yet
// wired to the daemon are shown disabled rather than faked.
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
  Tag,
  Typography,
} from 'antd';
import Image from 'next/image';
import {
  groupByTier,
  ctxLabel,
  jsonFetcher,
  type ActiveModels,
  type ModelInfo,
} from '@/lib/models';
import { useTheme, type ThemeMode } from '@/lib/stores/useTheme';
import type { ProviderMeta, ProviderState } from '@/lib/provider';
import { ProviderModal } from '@/components/Provider/ProviderModal';
import { McpSection } from '@/components/settings/McpSection';
import { AttachmentCacheCard } from '@/components/settings/AttachmentCacheCard';

const { Text, Title, Paragraph } = Typography;

interface DaemonConfig {
  max_concurrent_agents: number;
  memory: { shadow_runs: number };
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
  const { data: providersList } = useSWR<{ providers: ProviderMeta[] }>(
    '/api/providers',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const { data: providerState, mutate: mutateProvider } = useSWR<ProviderState>(
    '/api/provider',
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const [providerModalOpen, setProviderModalOpen] = useState(false);
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
      label: `${m.display_name} — ${ctxLabel(m.context_window)}`,
    })),
  }));

  async function setDefaultModel(modelId: string): Promise<void> {
    try {
      const res = await fetch('/api/models/agent/default', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Request failed (${res.status})`);
      }
      await mutateActive();
      message.success(`default → ${modelId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Update failed');
    }
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
    if (draft.max_concurrent_agents !== config.max_concurrent_agents) m.add('max_concurrent_agents');
    if (draft.memory.shadow_runs !== config.memory.shadow_runs) m.add('memory.shadow_runs');
    return m;
  })();
  const dirty = modifiedKeys.size > 0;

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

      <Section
        title="AI provider"
        hint="The engine the daemon talks to. Credentials live in ~/.aifleet/secrets.env (chmod 600)."
      >
        {(() => {
          const meta = providersList?.providers.find((p) => p.name === providerState?.name);
          if (!providerState?.connected || !meta) {
            return (
              <Space>
                <Tag color="warning">Not connected</Tag>
                <Button type="primary" onClick={() => setProviderModalOpen(true)}>
                  Connect a provider
                </Button>
              </Space>
            );
          }
          return (
            <Space size={12} align="center" wrap>
              <Image src={meta.logo} alt={meta.display_name} width={32} height={32} unoptimized />
              <Space direction="vertical" size={0}>
                <Text strong>{meta.display_name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {providerState.auth === 'local' ? 'Claude Code login' : 'API key from secrets.env'}
                  {providerState.validated_at
                    ? ` · validated ${new Date(providerState.validated_at).toLocaleString()}`
                    : ''}
                </Text>
              </Space>
              <Button onClick={() => setProviderModalOpen(true)}>Change</Button>
              <Button
                danger
                onClick={async () => {
                  await fetch('/api/provider', { method: 'DELETE' });
                  await mutateProvider();
                }}
              >
                Disconnect
              </Button>
            </Space>
          );
        })()}
      </Section>

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
            onChange={(v) => setDefaultModel(v)}
            showSearch
            optionFilterProp="label"
          />
          {active?.default && <Tag color="blue">{active.default}</Tag>}
        </Space>
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
        title="MCP servers"
        hint="External tools agents can use during a run — e.g. Chrome DevTools for the tester, GitHub for repo ops. Enabled servers are passed to every spawn."
      >
        <McpSection />
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

      <Section
        title="Caches"
        hint="In-process LRU for Azure attachment bytes. MCP probes are NOT cached — each Probe button re-spawns the command. Project users have their own 5-min server-side cache (not cleared here)."
      >
        <AttachmentCacheCard />
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

      <ProviderModal
        open={providerModalOpen}
        providers={providersList?.providers ?? []}
        initialName={providerState?.name ?? null}
        onConnected={async (state) => {
          setProviderModalOpen(false);
          await mutateProvider(state, { revalidate: false });
        }}
        onClose={() => setProviderModalOpen(false)}
      />
    </div>
  );
}
