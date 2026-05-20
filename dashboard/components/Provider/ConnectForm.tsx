'use client';
// Phase 18: provider-specific connect form. Currently only Claude is wired
// (the registry marks the others unavailable). The form covers two auth modes:
//   - api_key  : user pastes ANTHROPIC_API_KEY; we validate against /v1/models
//   - local    : user has Claude Code already logged in; we trust it
// Successful submit returns the new ProviderState to the parent so it can
// close the modal.
import { useState } from 'react';
import { App, Alert, Button, Form, Input, Radio, Space, Typography } from 'antd';
import { CheckCircleTwoTone } from '@ant-design/icons';
import type { AuthMethod, ProviderMeta, ProviderState } from '@/lib/provider';

const { Text, Paragraph, Link } = Typography;

export function ConnectForm({
  provider,
  onConnected,
}: {
  provider: ProviderMeta;
  onConnected: (state: ProviderState) => void;
}) {
  const { message } = App.useApp();
  const [auth, setAuth] = useState<AuthMethod>(provider.auth_methods[0] ?? 'api_key');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/provider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          auth,
          ...(auth === 'api_key' && apiKey ? { api_key: apiKey } : {}),
        }),
      });
      const body = (await res.json()) as ProviderState & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `daemon returned ${res.status}`);
        return;
      }
      message.success(`Connected to ${provider.display_name}`);
      onConnected(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  const canApiKey = provider.auth_methods.includes('api_key');
  const canLocal = provider.auth_methods.includes('local');

  return (
    <Form layout="vertical" component="div">
      <Form.Item label="Auth method">
        <Radio.Group value={auth} onChange={(e) => setAuth(e.target.value as AuthMethod)}>
          {canApiKey && (
            <Radio value="api_key">
              API key — stored in <Text code>~/.aifleet/secrets.env</Text>
            </Radio>
          )}
          {canLocal && (
            <Radio value="local">
              Use Claude Code login — daemon spawns the CLI with your existing credentials
            </Radio>
          )}
        </Radio.Group>
      </Form.Item>

      {auth === 'api_key' && (
        <Form.Item
          label="API key"
          help={
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              Get one at{' '}
              <Link href="https://console.anthropic.com/settings/keys" target="_blank">
                console.anthropic.com/settings/keys
              </Link>
              . Saved with chmod 600 — never committed.
            </Paragraph>
          }
        >
          <Input.Password
            autoFocus
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onPressEnter={submit}
          />
        </Form.Item>
      )}

      {auth === 'local' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Make sure Claude Code is installed and you're logged in"
          description={
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Run <Text code>claude /login</Text> in a terminal first. The daemon
              will use those credentials at spawn time.
            </Paragraph>
          }
        />
      )}

      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />
      )}

      <Space style={{ marginTop: 8 }}>
        <Button
          type="primary"
          loading={busy}
          icon={<CheckCircleTwoTone twoToneColor="#fff" />}
          disabled={auth === 'api_key' && apiKey.length < 10}
          onClick={submit}
        >
          Connect
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          We probe the API before saving — bad keys never persist.
        </Text>
      </Space>
    </Form>
  );
}
