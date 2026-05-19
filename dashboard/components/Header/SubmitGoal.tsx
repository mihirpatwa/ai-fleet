'use client';
// Header goal submit with an Advanced panel: per-task model override + starting
// agent + (phase-14) working dir, and a live median-cost preview for the
// chosen starting agent. POSTs {goal, project_root, model_override?, agent}.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { App, Button, Input, Popover, Segmented, Select, Space, Typography } from 'antd';
import { ControlOutlined, SendOutlined } from '@ant-design/icons';
import { AGENTS } from '@/lib/agents';
import {
  groupByTier,
  ctxLabel,
  priceLabel,
  jsonFetcher,
  type ActiveModels,
  type ModelInfo,
} from '@/lib/models';
import { pickDirectory } from '@/lib/dirPicker';

interface RecentProject {
  absolutePath: string;
  name: string;
}

const { Text } = Typography;

interface CostEstimate {
  agent: string | null;
  estimateUsd: number | null;
  samples: number;
}

export function SubmitGoal({ project, width = 320 }: { project: string; width?: number }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelOverride, setModelOverride] = useState<string>(''); // '' = global default
  const [agent, setAgent] = useState('orchestrator');
  // Per-submission working dir. '' = use the header's active project. Choosing
  // here does NOT change the header active project.
  const [wdMode, setWdMode] = useState<'current' | 'pick' | 'recent'>('current');
  const [workdir, setWorkdir] = useState('');

  const { data: recents } = useSWR<RecentProject[]>(
    '/api/recent-projects?limit=10',
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const { data: models } = useSWR<ModelInfo[]>('/api/models', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: active } = useSWR<ActiveModels>('/api/models/active', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: est } = useSWR<CostEstimate>(
    `/api/cost-estimate?agent=${encodeURIComponent(agent)}`,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const modelOptions = [
    { value: '', label: `Default${active?.default ? ` (${active.default})` : ''}` },
    ...groupByTier(models ?? []).map((g) => ({
      label: g.tier,
      title: g.tier,
      options: g.models.map((m) => ({
        value: m.id,
        label: `${m.display_name} — ${ctxLabel(m.context_window)}, ${priceLabel(m.pricing)}`,
      })),
    })),
  ];

  const costLine =
    est && est.estimateUsd != null
      ? `estimated cost: ~$${est.estimateUsd.toFixed(2)} for typical goals (based on last ${est.samples} ${agent} task${est.samples === 1 ? '' : 's'})`
      : 'no estimate yet';

  async function choosePick(): Promise<void> {
    const o = await pickDirectory();
    if (o.kind === 'resolved') setWorkdir(o.path);
    else if (o.kind === 'candidates') setWorkdir(o.candidates[0]?.absolute_path ?? '');
    else if (o.kind === 'fallback')
      message.info('No native folder picker — choose from Recent or use the header picker');
    // cancelled → keep previous
  }

  const effectiveProject = wdMode !== 'current' && workdir ? workdir : project;

  async function submit(): Promise<void> {
    const g = goal.trim();
    if (!g) return;
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
        }),
      });
      if (!res.ok) throw new Error(`Daemon returned ${res.status}`);
      message.success('Goal submitted');
      setGoal('');
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  const advanced = (
    <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Model for this goal
        </Text>
        <Select
          value={modelOverride}
          onChange={setModelOverride}
          options={modelOptions}
          style={{ width: '100%', marginTop: 4 }}
          size="small"
        />
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Starting agent
        </Text>
        <Select
          value={agent}
          onChange={setAgent}
          options={AGENTS.map((a) => ({ value: a, label: a }))}
          style={{ width: '100%', marginTop: 4 }}
          size="small"
          showSearch
        />
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Working directory
        </Text>
        <Segmented
          size="small"
          style={{ marginTop: 4, display: 'block' }}
          value={wdMode}
          onChange={(v) => {
            const m = v as 'current' | 'pick' | 'recent';
            setWdMode(m);
            if (m === 'current') setWorkdir('');
            if (m === 'pick') void choosePick();
          }}
          options={[
            { label: 'Current', value: 'current' },
            { label: 'Pick…', value: 'pick' },
            { label: 'Recent…', value: 'recent' },
          ]}
        />
        {wdMode === 'recent' && (
          <Select
            size="small"
            placeholder="recent folder"
            style={{ width: '100%', marginTop: 6 }}
            value={workdir || undefined}
            onChange={setWorkdir}
            options={(recents ?? []).map((r) => ({
              value: r.absolutePath,
              label: `${r.name} — ${r.absolutePath}`,
            }))}
          />
        )}
        <Text
          type="secondary"
          style={{ display: 'block', marginTop: 6, fontSize: 11, fontFamily: 'monospace' }}
        >
          {effectiveProject || '(no project)'}
        </Text>
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {costLine}
      </Text>
    </div>
  );

  return (
    <Space.Compact style={{ width, flex: '0 1 auto' }}>
      <Input
        placeholder="submit a goal…"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        onPressEnter={submit}
        disabled={busy}
      />
      <Popover content={advanced} title="Advanced" trigger="click" placement="bottomRight">
        <Button icon={<ControlOutlined />} aria-label="Advanced options" />
      </Popover>
      <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={submit}>
        Submit
      </Button>
    </Space.Compact>
  );
}
