'use client';
// Phase 18e: MCP server marketplace inside Settings. Lists bundled presets
// (Chrome DevTools, Playwright, GitHub, Postgres, Filesystem) with an enable
// toggle + env-var inputs for those that need credentials. Custom servers
// (user-added) get an edit/delete row. The daemon merges every enabled
// server into Claude SDK options.mcpServers per spawn.
import { useState } from 'react';
import useSWR from 'swr';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { jsonFetcher } from '@/lib/models';

const { Text, Paragraph } = Typography;

interface McpServer {
  name: string;
  display_name?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  preset?: boolean;
}

interface McpPreset {
  name: string;
  display_name?: string;
  command: string;
  args: string[];
  description: string;
  required_env?: string[];
  preset: true;
}

interface McpResponse {
  servers: McpServer[];
  presets: McpPreset[];
}

export function McpSection() {
  const { message } = App.useApp();
  const { data, mutate } = useSWR<McpResponse>('/api/mcp-servers', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const [editing, setEditing] = useState<McpServer | null>(null);

  async function saveServer(s: McpServer): Promise<void> {
    try {
      const res = await fetch(`/api/mcp-servers/${encodeURIComponent(s.name)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `daemon returned ${res.status}`);
      }
      await mutate();
      message.success(s.enabled ? `${s.name} enabled` : `${s.name} updated`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'save failed');
    }
  }

  async function deleteServer(name: string): Promise<void> {
    try {
      const res = await fetch(`/api/mcp-servers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`daemon returned ${res.status}`);
      await mutate();
      message.success(`${name} removed`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'delete failed');
    }
  }

  const presetMap = new Map((data?.presets ?? []).map((p) => [p.name, p]));
  const servers = data?.servers ?? [];

  return (
    <>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {servers.map((s) => {
          const meta = presetMap.get(s.name);
          const needsEnv = meta?.required_env ?? [];
          const missingEnv = needsEnv.filter((k) => !(s.env && s.env[k]));
          return (
            <Card key={s.name} size="small" styles={{ body: { padding: 12 } }}>
              <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Space direction="vertical" size={2} style={{ maxWidth: 520 }}>
                  <Space size={8} wrap>
                    <Text strong>{s.display_name ?? s.name}</Text>
                    {s.preset && <Tag color="default">preset</Tag>}
                    {!s.preset && <Tag color="purple">custom</Tag>}
                    {s.enabled && <Tag color="green">enabled</Tag>}
                    {s.enabled && missingEnv.length > 0 && (
                      <Tag color="warning">missing env: {missingEnv.join(', ')}</Tag>
                    )}
                  </Space>
                  {meta?.description && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {meta.description}
                    </Text>
                  )}
                  <Text
                    type="secondary"
                    style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}
                  >
                    {s.command} {s.args.join(' ')}
                  </Text>
                </Space>
                <Space>
                  <Tooltip title={s.enabled ? 'Disable' : 'Enable'}>
                    <Switch
                      checked={s.enabled}
                      onChange={(checked) => saveServer({ ...s, enabled: checked })}
                    />
                  </Tooltip>
                  <Button icon={<EditOutlined />} onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                  {!s.preset && (
                    <Button danger icon={<DeleteOutlined />} onClick={() => deleteServer(s.name)} />
                  )}
                </Space>
              </Space>
            </Card>
          );
        })}

        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setEditing(blankCustom())}>
            Add custom MCP
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
            Refresh
          </Button>
        </Space>
      </Space>

      <EditModal
        open={!!editing}
        value={editing}
        onClose={() => setEditing(null)}
        onSave={async (next) => {
          await saveServer(next);
          setEditing(null);
        }}
        presetMeta={editing ? presetMap.get(editing.name) ?? null : null}
      />
    </>
  );
}

function blankCustom(): McpServer {
  return { name: '', command: 'npx', args: [], enabled: false };
}

function EditModal({
  open,
  value,
  presetMeta,
  onClose,
  onSave,
}: {
  open: boolean;
  value: McpServer | null;
  presetMeta: McpPreset | null;
  onClose: () => void;
  onSave: (s: McpServer) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('npx');
  const [argsRaw, setArgsRaw] = useState('');
  const [env, setEnv] = useState<Record<string, string>>({});

  // Reset on open
  if (open && value && name !== value.name) {
    setName(value.name);
    setCommand(value.command);
    setArgsRaw(value.args.join(' '));
    setEnv(value.env ?? {});
  }

  async function submit(): Promise<void> {
    if (!value) return;
    const next: McpServer = {
      ...value,
      name: name.trim(),
      command: command.trim(),
      args: argsRaw.split(/\s+/).filter(Boolean),
      env: Object.keys(env).length ? env : undefined,
    } as McpServer;
    await onSave(next);
  }

  const required = presetMeta?.required_env ?? [];
  const customEnvKeys = Object.keys(env).filter((k) => !required.includes(k));

  return (
    <Modal
      title={value?.preset ? `Configure ${value.display_name ?? value.name}` : 'Custom MCP server'}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="Save"
      destroyOnClose
      getContainer={false}
    >
      <Form layout="vertical" component="div">
        {!value?.preset && (
          <>
            <Form.Item label="Name" required help="Used as the MCP key the agent calls.">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Form.Item>
            <Form.Item label="Command">
              <Input value={command} onChange={(e) => setCommand(e.target.value)} />
            </Form.Item>
            <Form.Item label="Args" help="Space-separated.">
              <Input value={argsRaw} onChange={(e) => setArgsRaw(e.target.value)} />
            </Form.Item>
          </>
        )}

        {required.length > 0 && (
          <>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              Required env vars for {presetMeta?.display_name ?? value?.name}:
            </Paragraph>
            {required.map((k) => (
              <Form.Item key={k} label={k}>
                <Input.Password
                  value={env[k] ?? ''}
                  onChange={(e) => setEnv((prev) => ({ ...prev, [k]: e.target.value }))}
                  placeholder={`${k} value (leave blank to clear)`}
                />
              </Form.Item>
            ))}
          </>
        )}

        {customEnvKeys.length > 0 && (
          <>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              Extra env vars:
            </Paragraph>
            {customEnvKeys.map((k) => (
              <Form.Item key={k} label={k}>
                <Input
                  value={env[k] ?? ''}
                  onChange={(e) => setEnv((prev) => ({ ...prev, [k]: e.target.value }))}
                />
              </Form.Item>
            ))}
          </>
        )}
      </Form>
    </Modal>
  );
}
