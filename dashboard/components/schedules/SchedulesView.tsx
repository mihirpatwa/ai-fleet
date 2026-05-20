'use client';
// r5: Scheduled tasks CRUD. The daemon runs them every minute (UTC); the
// dashboard lets the user create/edit/disable/delete rows. Cron expressions
// are 5-field (min hour dom mon dow). Validation lives daemon-side — a bad
// cron returns 400 from POST/PATCH.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { AGENTS } from '@/lib/agents';
import { jsonFetcher } from '@/lib/models';
import { roleColor } from '@/lib/theme';
import { ago } from '@/lib/format';

const { Text } = Typography;

interface ScheduledRow {
  id: string;
  name: string;
  cron: string;
  agent: string;
  input_json: unknown;
  project_root: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  enabled: boolean;
}

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

export function SchedulesView() {
  const { message } = App.useApp();
  const router = useRouter();
  const { data, mutate, isLoading } = useSWR<{ schedules: ScheduledRow[] }>(
    '/api/schedules',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const [editing, setEditing] = useState<ScheduledRow | null>(null);
  const [creating, setCreating] = useState(false);

  async function runNow(id: string, name: string): Promise<void> {
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(id)}/run`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as { task_id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `daemon returned ${res.status}`);
      message.success(`Fired ${name}`);
      // u12: always refresh the schedules table so last_run_at reflects the
      // fire even when we route away to the spawned task.
      await mutate();
      if (body.task_id) router.push(`/task/${body.task_id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'run failed');
    }
  }

  async function patch(id: string, body: Partial<ScheduledRow>): Promise<void> {
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error ?? `daemon returned ${res.status}`);
      await mutate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'update failed');
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`daemon returned ${res.status}`);
      await mutate();
      message.success('deleted');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'delete failed');
    }
  }

  const columns: ColumnsType<ScheduledRow> = [
    { title: 'Name', dataIndex: 'name', render: (n: string) => <Text strong>{n}</Text> },
    {
      title: 'Cron (UTC)',
      dataIndex: 'cron',
      render: (c: string) => <Text code>{c}</Text>,
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      render: (a: string) => <Tag style={tint(roleColor(a))}>{a}</Tag>,
    },
    {
      title: 'Project',
      dataIndex: 'project_root',
      render: (p: string | null) =>
        p ? (
          <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {p}
          </Text>
        ) : (
          <Text type="secondary">(global)</Text>
        ),
    },
    {
      title: 'Last',
      dataIndex: 'last_run_at',
      render: (t: string | null) => (t ? ago(t) : <Text type="secondary">—</Text>),
    },
    {
      title: 'Next',
      dataIndex: 'next_run_at',
      render: (t: string | null) => (t ? ago(t) : <Text type="secondary">—</Text>),
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      render: (e: boolean, r) => (
        <Switch checked={e} onChange={(checked) => void patch(r.id, { enabled: checked })} />
      ),
    },
    {
      title: '',
      key: 'actions',
      render: (_, r) => (
        <Space>
          <Tooltip title="Fire now (doesn't change the cron)">
            <Button
              icon={<ThunderboltOutlined />}
              size="small"
              onClick={() => void runNow(r.id, r.name)}
            />
          </Tooltip>
          <Button icon={<EditOutlined />} size="small" onClick={() => setEditing(r)}>
            Edit
          </Button>
          <Popconfirm
            title={`Delete ${r.name}?`}
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => void remove(r.id)}
          >
            <Button danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          New schedule
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Daemon evaluates the table every minute (UTC).
        </Text>
      </Space>
      <Table<ScheduledRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data?.schedules ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText:
            'No scheduled tasks yet. The daemon seeds three defaults (scribe-daily, memory-compact-weekly, deps-audit-daily) on first boot — give it a few seconds.',
        }}
      />

      <EditModal
        open={!!editing || creating}
        value={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={async () => {
          setEditing(null);
          setCreating(false);
          await mutate();
        }}
      />
    </>
  );
}

function EditModal({
  open,
  value,
  onClose,
  onSaved,
}: {
  open: boolean;
  value: ScheduledRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState(value?.name ?? '');
  const [cron, setCron] = useState(value?.cron ?? '0 0 * * *');
  const [agent, setAgent] = useState(value?.agent ?? 'scribe');
  const [project, setProject] = useState(value?.project_root ?? '');
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  // s3: cron validator + next-fire preview. Debounced fetch against the
  // daemon — bad expressions return valid:false + empty list.
  const [preview, setPreview] = useState<{ valid: boolean; next: string[] }>({
    valid: true,
    next: [],
  });

  // Reset whenever the modal opens for a new row.
  if (open && value && name !== value.name) {
    setName(value.name);
    setCron(value.cron);
    setAgent(value.agent);
    setProject(value.project_root ?? '');
    setEnabled(value.enabled);
  }
  if (open && !value && (name || cron !== '0 0 * * *')) {
    // freshly-opened "create" — reset
    setName('');
    setCron('0 0 * * *');
    setAgent('scribe');
    setProject('');
    setEnabled(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/schedules/preview?cron=${encodeURIComponent(cron)}&count=3`,
        );
        const body = (await res.json().catch(() => ({}))) as {
          valid?: boolean;
          next?: string[];
        };
        setPreview({ valid: !!body.valid, next: body.next ?? [] });
      } catch {
        setPreview({ valid: false, next: [] });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [cron, open]);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        cron: cron.trim(),
        agent,
        project_root: project.trim() || null,
        enabled,
      };
      const url = value ? `/api/schedules/${encodeURIComponent(value.id)}` : '/api/schedules';
      const method = value ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error ?? `daemon returned ${res.status}`);
      message.success(value ? 'Updated' : 'Created');
      await onSaved();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={value ? `Edit ${value.name}` : 'New schedule'}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={value ? 'Save' : 'Create'}
      okButtonProps={{ loading: busy }}
      destroyOnClose
      getContainer={false}
    >
      <Form layout="vertical" component="div">
        <Form.Item label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. weekly-deps-audit" />
        </Form.Item>
        <Form.Item
          label="Cron (UTC, 5-field)"
          validateStatus={preview.valid ? undefined : 'error'}
          help={
            preview.valid ? (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  min hour dom mon dow — e.g. <Text code>0 6 * * *</Text> daily 06:00 UTC.
                </Text>
                {preview.next.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Next runs (local time):{' '}
                    </Text>
                    {preview.next.map((ts) => {
                      const d = new Date(`${ts.replace(' ', 'T')}Z`);
                      const label = Number.isNaN(d.getTime())
                        ? ts
                        : d.toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                      return (
                        <Tooltip key={ts} title={`${ts} UTC`}>
                          <Tag color="default" style={{ marginInlineEnd: 4 }}>
                            {label}
                          </Tag>
                        </Tooltip>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 4 }}
                message="Invalid cron expression"
              />
            )
          }
        >
          <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 0 * * *" />
        </Form.Item>
        <Form.Item label="Agent">
          <Select
            value={agent}
            onChange={setAgent}
            options={AGENTS.map((a) => ({ value: a, label: a }))}
            showSearch
          />
        </Form.Item>
        <Form.Item label="Project root" help="Optional — defaults to ~/.aifleet">
          <Input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="/abs/path/to/project (or blank)"
          />
        </Form.Item>
        <Form.Item label="Enabled">
          <Switch checked={enabled} onChange={setEnabled} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
