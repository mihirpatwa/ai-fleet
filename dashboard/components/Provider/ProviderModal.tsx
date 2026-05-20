'use client';
// Phase 18 first-run modal. Mounted at the AppShell root; blocks the dashboard
// until a provider is connected. Two views:
//   1. Provider chooser — grid of cards (logo + tagline + capabilities)
//   2. Connect form — once a provider is picked, its ConnectForm renders
// Renders nothing if `open` is false. The parent owns the open state +
// refreshes its provider state on success so AppShell can let the app load.
import Image from 'next/image';
import { useState } from 'react';
import { Alert, Card, Col, Modal, Row, Space, Tag, Typography } from 'antd';
import { LeftOutlined } from '@ant-design/icons';
import type { ProviderMeta, ProviderName, ProviderState } from '@/lib/provider';
import { ConnectForm } from './ConnectForm';

const { Title, Paragraph, Text } = Typography;

function CapabilityChips({ p }: { p: ProviderMeta }) {
  const caps = p.capabilities;
  const items: { label: string; on: boolean }[] = [
    { label: 'Tool gate', on: caps.toolGate },
    { label: 'MCP', on: caps.mcp },
    { label: 'Agent loop', on: caps.agentLoop },
    { label: 'Streaming', on: caps.streaming },
  ];
  return (
    <Space size={[6, 4]} wrap style={{ marginTop: 8 }}>
      {items.map((c) => (
        <Tag key={c.label} color={c.on ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
          {c.label}
        </Tag>
      ))}
    </Space>
  );
}

function ProviderCard({
  p,
  active,
  onPick,
}: {
  p: ProviderMeta;
  active: boolean;
  onPick: (p: ProviderMeta) => void;
}) {
  const clickable = p.available;
  return (
    <Card
      hoverable={clickable}
      onClick={() => clickable && onPick(p)}
      style={{
        cursor: clickable ? 'pointer' : 'not-allowed',
        opacity: clickable ? 1 : 0.55,
        borderColor: active ? 'var(--ant-color-primary)' : undefined,
        borderWidth: active ? 2 : 1,
        height: '100%',
      }}
      styles={{ body: { padding: 16 } }}
    >
      <Space align="start" size={12} style={{ width: '100%' }}>
        <Image src={p.logo} alt={p.display_name} width={44} height={44} unoptimized />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={6}>
            <Text strong>{p.display_name}</Text>
            {!p.available && <Tag color="default">soon</Tag>}
          </Space>
          <Paragraph
            type="secondary"
            ellipsis={{ rows: 3 }}
            style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}
          >
            {p.tagline}
          </Paragraph>
          <CapabilityChips p={p} />
          {!p.available && p.reason && (
            <Text type="warning" style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
              {p.reason}
            </Text>
          )}
        </div>
      </Space>
    </Card>
  );
}

export function ProviderModal({
  open,
  providers,
  initialName,
  onConnected,
  onClose,
}: {
  open: boolean;
  providers: ProviderMeta[];
  /** Pre-select a provider (e.g. when reopened from Settings). */
  initialName?: ProviderName | null;
  onConnected: (state: ProviderState) => void;
  onClose?: () => void;
}) {
  const [picked, setPicked] = useState<ProviderMeta | null>(null);

  // Sync initialName → picked when the modal reopens for "Change".
  if (initialName && (!picked || picked.name !== initialName)) {
    const meta = providers.find((p) => p.name === initialName);
    if (meta?.available) setPicked(meta);
  }

  return (
    <Modal
      open={open}
      width={picked ? 560 : providers.length <= 2 ? 720 : 880}
      onCancel={onClose}
      closable={!!onClose}
      maskClosable={false}
      destroyOnClose
      footer={null}
      title={picked ? null : 'Choose your AI engine'}
      // Render inside the React tree (no portal escape) so the ConfigProvider's
      // cssVar block — which scopes --ant-* variables to its wrapper — actually
      // styles the modal in the active theme. Otherwise dark mode shows a
      // white modal because the portal mounts outside that scope.
      getContainer={false}
    >
      {!picked && (
        <>
          <Paragraph type="secondary" style={{ marginTop: -4 }}>
            ai-fleet talks to a single AI provider at a time. You can change this
            later in Settings.
          </Paragraph>
          <Row gutter={[16, 16]}>
            {providers.map((p) => (
              <Col
                key={p.name}
                xs={24}
                md={providers.length === 1 ? 24 : providers.length === 2 ? 12 : 8}
              >
                <ProviderCard p={p} active={false} onPick={setPicked} />
              </Col>
            ))}
          </Row>
        </>
      )}

      {picked && (
        <div>
          <Space style={{ marginBottom: 12 }}>
            <a onClick={() => setPicked(null)} style={{ cursor: 'pointer' }}>
              <LeftOutlined /> All providers
            </a>
          </Space>
          <Space align="start" size={12} style={{ marginBottom: 8 }}>
            <Image src={picked.logo} alt={picked.display_name} width={40} height={40} unoptimized />
            <div>
              <Title level={5} style={{ margin: 0 }}>
                Connect {picked.display_name}
              </Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {picked.tagline}
              </Text>
            </div>
          </Space>
          {!picked.available ? (
            <Alert
              type="warning"
              showIcon
              message={picked.reason ?? 'Not yet available'}
              style={{ marginTop: 8 }}
            />
          ) : (
            <ConnectForm provider={picked} onConnected={onConnected} />
          )}
        </div>
      )}
    </Modal>
  );
}
