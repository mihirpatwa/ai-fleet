'use client';
// Header [+ New goal] button → modal with the full submission form. Replaces
// the old inline Popover Advanced UI; long goals now have room to breathe and
// the model/agent/workdir overrides are first-class fields instead of hidden.
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined, SendOutlined } from '@ant-design/icons';
import { AGENTS } from '@/lib/agents';
import {
  groupByTier,
  ctxLabel,
  jsonFetcher,
  type ActiveModels,
  type ModelInfo,
} from '@/lib/models';
import { pickDirectory } from '@/lib/dirPicker';
import type { ProviderState } from '@/lib/provider';
import { useGoalModal } from '@/lib/stores/useGoalModal';
import { useGoalDefaults } from '@/lib/stores/useGoalDefaults';

const { Text, Paragraph } = Typography;

interface RecentProject {
  absolutePath: string;
  name: string;
}

type WdMode = 'current' | 'recent' | 'pick';
type Effort = 'low' | 'medium' | 'high' | 'max';

// Per-effort thinking-budget mapping shown in the tooltip. Claude SDK maps
// these named levels onto its reasoning-token budget internally; we just hint
// the magnitude so the user knows what they're picking.
const EFFORT_BUDGETS: Record<Effort, string> = {
  low: '~1K thinking tokens — fastest, cheapest',
  medium: '~8K thinking tokens — balanced default',
  high: '~32K thinking tokens — better at hard tasks',
  max: '~64K thinking tokens — slow + costly, best reasoning',
};

function EffortLabel({ value, label }: { value: Effort; label: string }) {
  return (
    <Tooltip title={EFFORT_BUDGETS[value]}>
      <span>{label}</span>
    </Tooltip>
  );
}

export function SubmitGoal({ project }: { project: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { message } = App.useApp();
  // t10: hook into the shared open/close store so other routes (work items
  // "Send as goal") can pop the modal without a navigation + sessionStorage
  // handoff. The local `open` state still drives the actual Modal mount —
  // we just mirror the store's open flag.
  const storeOpen = useGoalModal((s) => s.open);
  const storePrefillGoal = useGoalModal((s) => s.prefillGoal);
  const storePrefillSource = useGoalModal((s) => s.prefillSource);
  const storeShowCount = useGoalModal((s) => s.showCount);
  const hideStore = useGoalModal((s) => s.hide);
  // t7: persisted last-used effort + agent so the next session reopens with
  // the same picks. We don't persist goal text on purpose — each goal is a
  // fresh write.
  const defaultAgent = useGoalDefaults((s) => s.agent);
  const defaultEffort = useGoalDefaults((s) => s.effort);
  const defaultWdMode = useGoalDefaults((s) => s.wdMode);
  const setDefaultAgent = useGoalDefaults((s) => s.setAgent);
  const setDefaultEffort = useGoalDefaults((s) => s.setEffort);
  const setDefaultWdMode = useGoalDefaults((s) => s.setWdMode);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefillSource, setPrefillSource] = useState<string | null>(null);

  // Form state. Defaults applied on open (so model defaults track the latest
  // active.default each time the modal mounts).
  const [goal, setGoal] = useState('');
  const [agent, setAgent] = useState('orchestrator');
  const [modelOverride, setModelOverride] = useState<string>(''); // '' = default
  const [effort, setEffort] = useState<Effort>('medium');
  const [wdMode, setWdMode] = useState<WdMode>('current');
  const [workdir, setWorkdir] = useState('');

  const { data: models } = useSWR<ModelInfo[]>('/api/models', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: active } = useSWR<ActiveModels>('/api/models/active', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: recents } = useSWR<RecentProject[]>(
    '/api/recent-projects?limit=10',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const { data: providerState } = useSWR<ProviderState>('/api/provider', jsonFetcher, {
    revalidateOnFocus: false,
  });
  // q1: surface which MCPs the chosen starting agent will see at spawn time.
  const { data: mcpData } = useSWR<{
    servers: Array<{ name: string; display_name?: string; enabled: boolean; allowed_agents?: string[] }>;
  }>('/api/mcp-servers', jsonFetcher, { revalidateOnFocus: false });
  const mcpsForAgent =
    mcpData?.servers
      .filter((s) => s.enabled)
      .filter(
        (s) => !s.allowed_agents || s.allowed_agents.length === 0 || s.allowed_agents.includes(agent),
      ) ?? [];
  // Assume ok pre-fetch so the button doesn't flicker disabled on first paint;
  // once the SWR settles the real `connected` flag drives the gate.
  const providerOk = providerState ? providerState.connected : true;

  // Reset to defaults whenever the modal opens; honour either a sessionStorage
  // prefill (legacy ?openGoalModal=1 path) or a useGoalModal store prefill
  // (t10 direct-open path).
  useEffect(() => {
    if (!open) return;
    let prefill = storePrefillGoal;
    let source: string | null = storePrefillSource;
    if (!prefill) {
      try {
        prefill = sessionStorage.getItem('aifleet-prefill-goal') ?? '';
        source = sessionStorage.getItem('aifleet-prefill-source');
        if (prefill) {
          sessionStorage.removeItem('aifleet-prefill-goal');
          sessionStorage.removeItem('aifleet-prefill-source');
        }
      } catch {
        /* sessionStorage unavailable */
      }
    }
    setGoal(prefill);
    setPrefillSource(source);
    setAgent(defaultAgent);
    setModelOverride('');
    setEffort(defaultEffort);
    setWdMode(defaultWdMode);
    setWorkdir('');
  }, [
    open,
    storeShowCount,
    storePrefillGoal,
    storePrefillSource,
    defaultAgent,
    defaultEffort,
    defaultWdMode,
  ]);

  // Mirror the store's `open` into the local Modal-driving state. u20: rely
  // on showCount (not storeOpen) so back-to-back show() calls re-fire the
  // open + reset effect even when the modal was already open.
  useEffect(() => {
    if (storeOpen) setOpen(true);
  }, [storeOpen, storeShowCount]);

  // v13: Cmd/Ctrl+K opens the modal and focuses the goal textarea (common
  // AI-app pattern). Bails when focus is inside any other text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      const t = e.target as HTMLElement | null;
      const inOtherInput =
        !!t &&
        (t.tagName === 'INPUT' || t.isContentEditable) &&
        t.getAttribute('data-aifleet-goal') !== '1';
      if (inOtherInput) return;
      e.preventDefault();
      if (!open) setOpen(true);
      setTimeout(() => {
        const ta = document.querySelector<HTMLTextAreaElement>(
          'textarea[data-aifleet-goal="1"]',
        );
        ta?.focus();
      }, 50);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-open the modal when arrived with ?openGoalModal=1 (Work items
  // "Send as goal" route). One-shot: strip the param so a back-nav doesn't
  // re-fire.
  useEffect(() => {
    if (sp.get('openGoalModal') !== '1') return;
    setOpen(true);
    const next = new URLSearchParams(sp.toString());
    next.delete('openGoalModal');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // pathname/sp deps trigger on history nav too; the guard at top is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const effectiveProject = wdMode !== 'current' && workdir ? workdir : project;
  const effectiveModel =
    modelOverride === '__adaptive__'
      ? 'adaptive'
      : modelOverride || active?.default || '';

  const modelOptions = [
    { value: '', label: `Default${active?.default ? ` — ${active.default}` : ''}` },
    {
      value: '__adaptive__',
      label: 'Adaptive — pick per agent + complexity',
    },
    ...groupByTier(models ?? []).map((g) => ({
      label: g.tier,
      title: g.tier,
      options: g.models.map((m) => ({
        value: m.id,
        label: `${m.display_name} — ${ctxLabel(m.context_window)}`,
      })),
    })),
  ];

  async function choosePick(): Promise<void> {
    const o = await pickDirectory();
    if (o.kind === 'resolved') {
      setWorkdir(o.path);
      setWdMode('pick');
    } else if (o.kind === 'candidates') {
      setWorkdir(o.candidates[0]?.absolute_path ?? '');
      setWdMode('pick');
    } else if (o.kind === 'fallback') {
      message.info('No native folder picker — pick a Recent or use the header picker.');
      setWdMode('current');
    }
    // cancelled → revert
  }

  async function submit(): Promise<void> {
    const g = goal.trim();
    if (!g) {
      message.warning('Enter a goal first');
      return;
    }
    if (!effectiveProject) {
      message.warning('Pick a project first');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: g,
          project_root: effectiveProject,
          agent,
          ...(modelOverride ? { model_override: modelOverride } : {}),
          effort,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Daemon returned ${res.status}`);
      }
      message.success('Goal submitted');
      setOpen(false);
      hideStore();
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Tooltip
        title={providerOk ? '' : 'Connect an AI provider first (Settings → AI provider).'}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setOpen(true)}
          disabled={!providerOk}
        >
          New goal
        </Button>
      </Tooltip>

      <Modal
        title="Submit a goal"
        open={open}
        width={640}
        onCancel={() => {
          setOpen(false);
          hideStore();
        }}
        destroyOnClose
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setOpen(false);
              hideStore();
            }}
          >
            Cancel
          </Button>,
          <Button
            key="ok"
            type="primary"
            icon={<SendOutlined />}
            loading={busy}
            disabled={!providerOk}
            onClick={submit}
          >
            Submit
          </Button>,
        ]}
      >
        <Form layout="vertical" component="div">
          {!providerOk && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="No AI provider connected"
              description="Connect a provider in Settings → AI provider before submitting goals."
            />
          )}
          {prefillSource && (
            <Alert
              type="info"
              showIcon
              closable
              onClose={() => setPrefillSource(null)}
              style={{ marginBottom: 16 }}
              message={`Prefilled from ${prefillSource}`}
              description="Edit before submitting if needed."
            />
          )}
          <Form.Item
            label="Goal"
            required
            help="Cmd/Ctrl+Enter to submit. Cmd/Ctrl+K from anywhere to focus this field."
          >
            <Input.TextArea
              autoFocus
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder="e.g. Review the browse-profile route components and align their design with browse-support."
              data-aifleet-goal="1"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </Form.Item>

          <Form.Item label="Working directory">
            <Segmented<WdMode>
              size="small"
              block
              value={wdMode}
              onChange={(v) => {
                setWdMode(v);
                setDefaultWdMode(v);
                if (v === 'current') setWorkdir('');
                if (v === 'pick') void choosePick();
              }}
              options={[
                { label: 'Current', value: 'current' },
                { label: 'Recent…', value: 'recent' },
                { label: 'Pick…', value: 'pick' },
              ]}
            />
            {wdMode === 'recent' && (
              <Select
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Choose a recent folder"
                value={workdir || undefined}
                onChange={setWorkdir}
                options={(recents ?? []).map((r) => ({
                  value: r.absolutePath,
                  label: `${r.name}  —  ${r.absolutePath}`,
                }))}
              />
            )}
            <Paragraph
              type="secondary"
              copyable={{ text: effectiveProject || '' }}
              style={{
                marginTop: 8,
                marginBottom: 0,
                fontSize: 12,
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {effectiveProject || '(no project — pick one)'}
            </Paragraph>
          </Form.Item>

          <Space.Compact block style={{ gap: 12, display: 'flex' }}>
            <Form.Item
              label={
                <Space size={6}>
                  <span>Model</span>
                  {providerState?.connected && (
                    <Tag color="blue" style={{ marginInlineEnd: 0, fontWeight: 400 }}>
                      {providerState.name}
                    </Tag>
                  )}
                </Space>
              }
              help={
                providerState?.connected
                  ? `Models served by the ${providerState.name} provider.`
                  : undefined
              }
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Select
                value={modelOverride}
                onChange={setModelOverride}
                options={modelOptions}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item label="Starting agent" style={{ flex: 1, marginBottom: 0 }}>
              <Select
                value={agent}
                onChange={(v) => {
                  setAgent(v);
                  setDefaultAgent(v);
                }}
                options={AGENTS.map((a) => ({ value: a, label: a }))}
                showSearch
              />
            </Form.Item>
          </Space.Compact>

          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              MCPs visible to {agent}:
            </Text>{' '}
            {mcpsForAgent.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                memory only
              </Text>
            ) : (
              <Space size={[4, 4]} wrap style={{ marginLeft: 4 }}>
                <Tag color="default">memory</Tag>
                {mcpsForAgent.map((s) => (
                  <Tag key={s.name} color="cyan">
                    {s.display_name ?? s.name}
                  </Tag>
                ))}
              </Space>
            )}
          </div>

          <Form.Item
            label="Reasoning effort"
            style={{ marginTop: 16, marginBottom: 0 }}
            help="Higher = more thinking tokens before each answer. Slower + costlier, but better at hard tasks. Models silently downgrade if they don't support the level."
          >
            <Segmented<Effort>
              block
              value={effort}
              onChange={(v) => {
                setEffort(v);
                setDefaultEffort(v);
              }}
              options={[
                { label: <EffortLabel value="low" label="Low" />, value: 'low' },
                { label: <EffortLabel value="medium" label="Medium" />, value: 'medium' },
                { label: <EffortLabel value="high" label="High" />, value: 'high' },
                { label: <EffortLabel value="max" label="Max" />, value: 'max' },
              ]}
            />
          </Form.Item>

          <div style={{ marginTop: 16, padding: 12, borderRadius: 6, background: 'rgba(99,102,241,0.08)' }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text strong style={{ fontSize: 12 }}>
                Run preview
              </Text>
              <Space wrap size={[8, 4]}>
                <Tag color="purple">{agent}</Tag>
                <Tag color="blue">{effectiveModel || 'default'}</Tag>
                <Tag color="geekblue">{effort} effort</Tag>
              </Space>
            </Space>
          </div>
        </Form>
      </Modal>
    </>
  );
}
