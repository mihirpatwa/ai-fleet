'use client';
// Phase 18g: Work Items page — Azure DevOps list + filter + detail drawer +
// one-click "Send as goal" that prefills the SubmitGoal modal.
//
// Flow:
//   1. Fetch /api/azure/connection — show "Connect" CTA if not configured.
//   2. Otherwise SWR-list /api/azure/work-items with the active filters.
//   3. Row click opens the drawer with /api/azure/work-items/:id.
//   4. "Send as goal" stitches the work item into a structured prompt and
//      stores it in sessionStorage; user is redirected to / where the
//      header SubmitGoal modal picks it up.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClearOutlined, RocketOutlined, SettingOutlined } from '@ant-design/icons';
import { jsonFetcher } from '@/lib/models';
import {
  sanitizeHtml,
  workItemToGoal,
  type AzureConnectionState,
  type WorkItemDetail,
  type WorkItemSummary,
} from '@/lib/azure';

const { Text, Paragraph, Title } = Typography;

const TYPES = ['User Story', 'Feature', 'Task', 'Bug', 'Epic'];
const STATES = ['New', 'Active', 'Resolved', 'Closed', 'Removed'];

export function WorkItemsView() {
  const router = useRouter();
  const { message } = App.useApp();
  const [filters, setFilters] = useState<{
    type?: string[];
    state?: string[];
    search?: string;
  }>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data: conn, mutate: mutateConn } = useSWR<AzureConnectionState>(
    '/api/azure/connection',
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const listKey = conn?.connected
    ? `/api/azure/work-items?${buildQuery(filters)}`
    : null;
  const { data: listData, error: listError, isLoading } = useSWR<{ items: WorkItemSummary[] }>(
    listKey,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const items = listData?.items ?? [];

  const { data: detail } = useSWR<WorkItemDetail>(
    openId && conn?.connected ? `/api/azure/work-items/${openId}` : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  function sendAsGoal(item: WorkItemDetail): void {
    const prompt = workItemToGoal(item);
    try {
      sessionStorage.setItem('aifleet-prefill-goal', prompt);
      sessionStorage.setItem(
        'aifleet-prefill-source',
        `Azure ${item.type} #${item.id}`,
      );
    } catch {
      /* sessionStorage might be unavailable — ignore */
    }
    message.success(`Prefilled goal from ${item.type} #${item.id}. Opening submit modal…`);
    router.push('/?openGoalModal=1');
  }

  if (!conn) {
    return <Paragraph type="secondary">Loading…</Paragraph>;
  }
  if (!conn.connected) {
    return (
      <>
        <Empty
          description={
            <Space direction="vertical" align="center">
              <Text>No Azure DevOps connection.</Text>
              <Text type="secondary">
                Connect via org URL + project + PAT to list User Stories,
                Features, Tasks and Bugs here.
              </Text>
            </Space>
          }
        >
          <Button
            type="primary"
            icon={<SettingOutlined />}
            onClick={() => setConnectOpen(true)}
          >
            Connect Azure Boards
          </Button>
        </Empty>
        <ConnectModal
          open={connectOpen}
          state={conn}
          onClose={() => setConnectOpen(false)}
          onConnected={async () => {
            setConnectOpen(false);
            await mutateConn();
          }}
        />
      </>
    );
  }

  const columns: ColumnsType<WorkItemSummary> = [
    { title: 'ID', dataIndex: 'id', width: 80, render: (id: number) => <Text code>#{id}</Text> },
    {
      title: 'Type',
      dataIndex: 'type',
      width: 120,
      render: (t: string) => <Tag color={typeColor(t)}>{t}</Tag>,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (t: string, r) => (
        <a onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
          {t}
        </a>
      ),
    },
    { title: 'State', dataIndex: 'state', width: 110 },
    {
      title: 'Assigned',
      dataIndex: 'assigned_to',
      width: 160,
      render: (a: string | null) => a ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'Iteration',
      dataIndex: 'iteration_path',
      width: 220,
      render: (p: string | null) =>
        p ? <Text type="secondary" style={{ fontSize: 12 }}>{p}</Text> : '—',
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16, width: '100%' }} size={[12, 8]}>
        <Select
          mode="multiple"
          allowClear
          placeholder="Type"
          style={{ minWidth: 220 }}
          value={filters.type}
          onChange={(type) => setFilters((f) => ({ ...f, type }))}
          options={TYPES.map((t) => ({ value: t, label: t }))}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="State"
          style={{ minWidth: 220 }}
          value={filters.state}
          onChange={(state) => setFilters((f) => ({ ...f, state }))}
          options={STATES.map((s) => ({ value: s, label: s }))}
        />
        <Input.Search
          allowClear
          placeholder="Search title…"
          style={{ width: 240 }}
          onSearch={(search) =>
            setFilters((f) => ({ ...f, search: search.trim() || undefined }))
          }
        />
        <Button icon={<ClearOutlined />} onClick={() => setFilters({})}>
          Clear
        </Button>
        <Text type="secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {conn.org_url}/{conn.project}
        </Text>
        <Button size="small" onClick={() => setConnectOpen(true)}>
          Connection
        </Button>
      </Space>

      {listError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Azure call failed"
          description={String(listError)}
        />
      )}

      <Table<WorkItemSummary>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: 'No work items match these filters.' }}
      />

      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        width={720}
        title={
          detail ? (
            <Space>
              <Tag color={typeColor(detail.type)}>{detail.type}</Tag>
              <Text strong>#{detail.id}</Text>
              <Text>{detail.title}</Text>
            </Space>
          ) : (
            'Loading…'
          )
        }
        extra={
          detail && (
            <Space>
              <Link href={detail.url} target="_blank">
                <Button>Open in Azure</Button>
              </Link>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                onClick={() => sendAsGoal(detail)}
              >
                Send as goal
              </Button>
            </Space>
          )
        }
      >
        {detail && <WorkItemBody item={detail} />}
      </Drawer>

      <ConnectModal
        open={connectOpen}
        state={conn}
        onClose={() => setConnectOpen(false)}
        onConnected={async () => {
          setConnectOpen(false);
          await mutateConn();
        }}
      />
    </div>
  );
}

function WorkItemBody({ item }: { item: WorkItemDetail }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap size={[6, 4]}>
        <Tag>{item.state}</Tag>
        {item.assigned_to && <Tag color="blue">{item.assigned_to}</Tag>}
        {item.priority != null && <Tag>P{item.priority}</Tag>}
        {item.severity && <Tag color="orange">{item.severity}</Tag>}
        {item.tags.map((t) => (
          <Tag key={t} color="purple">
            {t}
          </Tag>
        ))}
      </Space>

      {item.description_html && (
        <Section title="Description" html={item.description_html} />
      )}
      {item.acceptance_criteria_html && (
        <Section title="Acceptance criteria" html={item.acceptance_criteria_html} />
      )}
      {item.repro_steps_html && (
        <Section title="Repro steps" html={item.repro_steps_html} />
      )}

      {item.attachments.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 8 }}>
            Attachments
          </Title>
          <Space direction="vertical">
            {item.attachments.map((a) => (
              <Link key={a.url} href={a.url} target="_blank">
                {a.name}
                {typeof a.size === 'number' && (
                  <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                    ({Math.round(a.size / 1024)} KB)
                  </Text>
                )}
              </Link>
            ))}
          </Space>
        </>
      )}

      {item.relations.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 8 }}>
            Relations
          </Title>
          <Space direction="vertical">
            {item.relations.map((r) => (
              <Text key={r.url} style={{ fontSize: 12 }}>
                <Tag>{r.rel}</Tag>
                {r.target_id ? `#${r.target_id}` : r.url}
              </Text>
            ))}
          </Space>
        </>
      )}
    </Space>
  );
}

function Section({ title, html }: { title: string; html: string }) {
  return (
    <>
      <Title level={5} style={{ marginBottom: 8 }}>
        {title}
      </Title>
      <div
        className="azure-html"
        style={{ fontSize: 14 }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
    </>
  );
}

function ConnectModal({
  open,
  state,
  onClose,
  onConnected,
}: {
  open: boolean;
  state: AzureConnectionState;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [orgUrl, setOrgUrl] = useState(state.org_url);
  const [project, setProject] = useState(state.project);
  const [pat, setPat] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/azure/connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_url: orgUrl, project, pat }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(body.error ?? `daemon returned ${res.status}`);
        return;
      }
      message.success('Azure connected');
      await onConnected();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    await fetch('/api/azure/connection', { method: 'DELETE' });
    setPat('');
    message.success('Disconnected');
    await onConnected();
  }

  return (
    <Modal
      title="Azure DevOps connection"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      getContainer={false}
    >
      <Form layout="vertical" component="div">
        <Form.Item
          label="Org URL"
          help="e.g. https://dev.azure.com/contoso"
        >
          <Input
            value={orgUrl}
            onChange={(e) => setOrgUrl(e.target.value)}
            placeholder="https://dev.azure.com/<your-org>"
          />
        </Form.Item>
        <Form.Item label="Project">
          <Input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="<your-project>"
          />
        </Form.Item>
        <Form.Item
          label="Personal Access Token"
          help={
            <>
              Needs <Text code>Work Items: Read</Text> scope. Stored in{' '}
              <Text code>~/.aifleet/secrets.env</Text> (chmod 600).
            </>
          }
        >
          <Input.Password
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder={state.connected ? '••••••• (saved)' : 'paste PAT'}
          />
        </Form.Item>

        {err && (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message={err} />
        )}

        <Space>
          <Button type="primary" loading={busy} onClick={submit}>
            Save + validate
          </Button>
          {state.connected && (
            <Tooltip title="Clears connection + scrubs the PAT from secrets.env">
              <Button danger onClick={disconnect}>
                Disconnect
              </Button>
            </Tooltip>
          )}
        </Space>
      </Form>
    </Modal>
  );
}

function buildQuery(f: { type?: string[]; state?: string[]; search?: string }): string {
  const p = new URLSearchParams();
  if (f.type && f.type.length > 0) p.set('type', f.type.join(','));
  if (f.state && f.state.length > 0) p.set('state', f.state.join(','));
  if (f.search) p.set('search', f.search);
  return p.toString();
}

function typeColor(t: string): string {
  switch (t) {
    case 'Bug':
      return 'red';
    case 'Feature':
      return 'purple';
    case 'User Story':
      return 'blue';
    case 'Epic':
      return 'magenta';
    case 'Task':
      return 'cyan';
    default:
      return 'default';
  }
}
