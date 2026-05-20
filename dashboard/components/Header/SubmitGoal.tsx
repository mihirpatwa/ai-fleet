'use client';
// Header [+ New goal] button → modal with the full submission form. Replaces
// the old inline Popover Advanced UI; long goals now have room to breathe and
// the model/agent/workdir overrides are first-class fields instead of hidden.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
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

const { Text, Paragraph } = Typography;

interface RecentProject {
  absolutePath: string;
  name: string;
}

type WdMode = 'current' | 'recent' | 'pick';
type Effort = 'low' | 'medium' | 'high' | 'max';

export function SubmitGoal({ project }: { project: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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

  // Reset to defaults whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setGoal('');
    setAgent('orchestrator');
    setModelOverride('');
    setEffort('medium');
    setWdMode('current');
    setWorkdir('');
  }, [open]);

  const effectiveProject = wdMode !== 'current' && workdir ? workdir : project;
  const effectiveModel = modelOverride || active?.default || '';

  const modelOptions = [
    { value: '', label: `Default${active?.default ? ` — ${active.default}` : ''}` },
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
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        New goal
      </Button>

      <Modal
        title="Submit a goal"
        open={open}
        width={640}
        onCancel={() => setOpen(false)}
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="ok"
            type="primary"
            icon={<SendOutlined />}
            loading={busy}
            onClick={submit}
          >
            Submit
          </Button>,
        ]}
      >
        <Form layout="vertical" component="div">
          <Form.Item
            label="Goal"
            required
            help="Cmd/Ctrl+Enter to submit. Be specific — agents follow your prompt verbatim."
          >
            <Input.TextArea
              autoFocus
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder="e.g. Review the browse-profile route components and align their design with browse-support."
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
            <Form.Item label="Model" style={{ flex: 1, marginBottom: 0 }}>
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
                onChange={setAgent}
                options={AGENTS.map((a) => ({ value: a, label: a }))}
                showSearch
              />
            </Form.Item>
          </Space.Compact>

          <Form.Item
            label="Reasoning effort"
            style={{ marginTop: 16, marginBottom: 0 }}
            help="Higher = more thinking tokens before each answer. Slower + costlier, but better at hard tasks. Models silently downgrade if they don't support the level."
          >
            <Segmented<Effort>
              block
              value={effort}
              onChange={setEffort}
              options={[
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
                { label: 'Max', value: 'max' },
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
