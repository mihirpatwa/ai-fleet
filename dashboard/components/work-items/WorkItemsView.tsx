'use client';
// Phase 18g (enriched): /work-items — Azure DevOps list + filter + detail
// drawer + one-click "Send as goal".
//
// Detail drawer surfaces every Azure field we have:
//   - sticky meta strip (state, assigned, priority, story points, iteration,
//     area, created-by/date, tags)
//   - Description / Acceptance criteria / Repro steps (sanitized HTML; img +
//     href to the connected org are rewritten to /api/azure/attachment so
//     inline images/videos render PAT-authed)
//   - Discussion: comments via /api/azure/work-items/:id/comments
//   - Attachments grid: images rendered inline, other files as links
//   - Relations grouped: linked work items / pull requests / commits /
//     branches / other
//
// Filters are dynamic where possible: state options come from
// /api/azure/states (per Azure project config); assignees, iterations,
// areas and tags are derived from the loaded items so the dropdowns only
// show values that exist.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Alert,
  App,
  Avatar,
  Button,
  Drawer,
  Empty,
  Form,
  Image as AntImage,
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
import { ClearOutlined, FileOutlined, RocketOutlined, SettingOutlined } from '@ant-design/icons';
import { jsonFetcher } from '@/lib/models';
import {
  decodeArtifactLabel,
  groupRelations,
  sanitizeHtml,
  workItemToGoal,
  type AzureConnectionState,
  type WorkItemComment,
  type WorkItemDetail,
  type WorkItemRelation,
  type WorkItemSummary,
} from '@/lib/azure';

const { Text, Paragraph, Title } = Typography;

const TYPES = ['User Story', 'Feature', 'Task', 'Bug', 'Epic'];
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov)(\?|$)/i;

export function WorkItemsView() {
  const router = useRouter();
  const { message } = App.useApp();
  const [filters, setFilters] = useState<{
    type?: string[];
    state?: string[];
    assigned_to?: string;
    iteration_path?: string;
    tag?: string;
    search?: string;
  }>({});
  const [page, setPage] = useState(1); // 1-based for Antd
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<number | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data: conn, mutate: mutateConn } = useSWR<AzureConnectionState>(
    '/api/azure/connection',
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  // Dynamic state list — fetched once per connection so workflows with
  // custom states (QA, In Progress, etc.) show up in the dropdown.
  const { data: statesData } = useSWR<{ states: string[] }>(
    conn?.connected ? '/api/azure/states' : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const stateOptions = (statesData?.states ?? []).map((s) => ({ value: s, label: s }));

  const listKey = conn?.connected
    ? `/api/azure/work-items?${buildQuery(filters, page - 1, pageSize)}`
    : null;
  const { data: listData, error: listError, isLoading } = useSWR<{
    items: WorkItemSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>(listKey, jsonFetcher, { revalidateOnFocus: false });
  const items = listData?.items ?? [];
  const total = listData?.total ?? items.length;

  // Derive assignee / iteration / tag options from the loaded items so the
  // dropdowns only contain values that actually exist in the project.
  const assigneeOptions = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.assigned_to).filter((v): v is string => !!v)))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [items],
  );
  const iterationOptions = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.iteration_path).filter((v): v is string => !!v)))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [items],
  );

  const { data: detail, mutate: mutateDetail } = useSWR<WorkItemDetail>(
    openId && conn?.connected ? `/api/azure/work-items/${openId}` : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const { data: commentsData } = useSWR<{ comments: WorkItemComment[] }>(
    openId && conn?.connected ? `/api/azure/work-items/${openId}/comments` : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  // q7: PATCH the work item's System.State and refresh both the drawer detail
  // and the list (so the table shows the new state immediately).
  async function changeState(id: number, nextState: string): Promise<void> {
    try {
      const res = await fetch(`/api/azure/work-items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: nextState }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `daemon returned ${res.status}`);
      message.success(`#${id} → ${nextState}`);
      // Re-fetch list (state changed) and re-set detail to the daemon's reply.
      await mutateDetail();
      // Cheap force-revalidate the list query — null-safe.
      if (listKey) void fetch(listKey).catch(() => undefined);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'state update failed');
    }
  }

  function sendAsGoal(item: WorkItemDetail): void {
    const prompt = workItemToGoal(item);
    try {
      sessionStorage.setItem('aifleet-prefill-goal', prompt);
      sessionStorage.setItem('aifleet-prefill-source', `Azure ${item.type} #${item.id}`);
    } catch {
      /* sessionStorage unavailable */
    }
    message.success(`Prefilled goal from ${item.type} #${item.id}. Opening submit modal…`);
    router.push('/?openGoalModal=1');
  }

  if (!conn) return <Paragraph type="secondary">Loading…</Paragraph>;
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
          <Button type="primary" icon={<SettingOutlined />} onClick={() => setConnectOpen(true)}>
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
      width: 130,
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
    { title: 'State', dataIndex: 'state', width: 120 },
    {
      title: 'Assigned',
      dataIndex: 'assigned_to',
      width: 180,
      render: (a: string | null) => a ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'Iteration',
      dataIndex: 'iteration_path',
      width: 240,
      render: (p: string | null) =>
        p ? <Text type="secondary" style={{ fontSize: 12 }}>{p}</Text> : '—',
    },
  ];

  return (
    <div>
      {/* q3: each filter has flex-basis so they collapse to ~full width on
          xs and pack 2–3 per row on sm/md. */}
      <Space wrap style={{ marginBottom: 16, width: '100%' }} size={[12, 8]}>
        <Select
          mode="multiple"
          allowClear
          placeholder="Type"
          style={{ flex: '1 1 200px', minWidth: 160, maxWidth: 320 }}
          value={filters.type}
          onChange={(type) => setFilters((f) => ({ ...f, type }))}
          options={TYPES.map((t) => ({ value: t, label: t }))}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder={statesData ? 'State' : 'Loading states…'}
          style={{ flex: '1 1 200px', minWidth: 160, maxWidth: 320 }}
          value={filters.state}
          onChange={(state) => setFilters((f) => ({ ...f, state }))}
          options={stateOptions}
          notFoundContent={statesData ? 'No states found' : 'Loading…'}
        />
        <Select
          allowClear
          placeholder="Assignee"
          style={{ flex: '1 1 180px', minWidth: 140, maxWidth: 240 }}
          value={filters.assigned_to}
          onChange={(assigned_to) => setFilters((f) => ({ ...f, assigned_to }))}
          options={assigneeOptions}
          showSearch
        />
        <Select
          allowClear
          placeholder="Iteration"
          style={{ flex: '1 1 200px', minWidth: 160, maxWidth: 280 }}
          value={filters.iteration_path}
          onChange={(iteration_path) => setFilters((f) => ({ ...f, iteration_path }))}
          options={iterationOptions}
          showSearch
        />
        <Input
          allowClear
          placeholder="Tag"
          style={{ flex: '0 1 140px', minWidth: 110 }}
          value={filters.tag}
          onChange={(e) =>
            setFilters((f) => ({ ...f, tag: e.target.value || undefined }))
          }
        />
        <Input.Search
          allowClear
          placeholder="Search title…"
          style={{ flex: '1 1 200px', minWidth: 160 }}
          onSearch={(search) =>
            setFilters((f) => ({ ...f, search: search.trim() || undefined }))
          }
        />
        <Button icon={<ClearOutlined />} onClick={() => setFilters({})}>
          Clear
        </Button>
        <Button size="small" onClick={() => setConnectOpen(true)}>
          Connection
        </Button>
        <Text
          type="secondary"
          style={{ marginLeft: 'auto', fontSize: 12, wordBreak: 'break-all' }}
        >
          {total} item{total === 1 ? '' : 's'} · {conn.org_url}/{conn.project}
        </Text>
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
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100, 200],
          showTotal: (n, range) => `${range[0]}–${range[1]} of ${n}`,
          onChange: (p, s) => {
            setPage(p);
            setPageSize(s);
          },
        }}
        // q3: horizontal scroll keeps the table usable at 375px wide.
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText:
            'No work items match these filters. Clear filters or widen the search.',
        }}
      />

      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        // q3: never wider than the viewport — Drawer clamps to 100vw when the
        // numeric width exceeds it but the explicit min keeps it readable on
        // small phones too.
        width="min(840px, 100vw)"
        title={
          detail ? (
            <Space>
              <Tag color={typeColor(detail.type)}>{detail.type}</Tag>
              <Text code>#{detail.id}</Text>
              <Text>{detail.title}</Text>
            </Space>
          ) : (
            'Loading…'
          )
        }
        extra={
          detail && (
            <Space>
              <Link href={azureWebUrl(conn, detail.id)} target="_blank">
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
        {detail && (
          <WorkItemBody
            item={detail}
            comments={commentsData?.comments ?? []}
            orgUrl={conn.org_url}
            states={statesData?.states ?? []}
            onChangeState={(next) => changeState(detail.id, next)}
          />
        )}
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

/* ----------------------------- detail body ---------------------------- */

function WorkItemBody({
  item,
  comments,
  orgUrl,
  states,
  onChangeState,
}: {
  item: WorkItemDetail;
  comments: WorkItemComment[];
  orgUrl: string;
  states: string[];
  onChangeState: (next: string) => void | Promise<void>;
}) {
  const grouped = groupRelations(item.relations);
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <MetaStrip item={item} states={states} onChangeState={onChangeState} />

      {item.description_html && (
        <Section title="Description">
          <SanitizedHtml html={item.description_html} orgUrl={orgUrl} />
        </Section>
      )}
      {item.acceptance_criteria_html && (
        <Section title="Acceptance criteria">
          <SanitizedHtml html={item.acceptance_criteria_html} orgUrl={orgUrl} />
        </Section>
      )}
      {item.repro_steps_html && (
        <Section title="Repro steps">
          <SanitizedHtml html={item.repro_steps_html} orgUrl={orgUrl} />
        </Section>
      )}
      {item.system_history_html && (
        <Section title="Latest history note">
          <SanitizedHtml html={item.system_history_html} orgUrl={orgUrl} />
        </Section>
      )}

      <Section title={`Discussion (${comments.length})`}>
        {comments.length === 0 ? (
          <Text type="secondary">No comments yet.</Text>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {comments.map((c) => (
              <CommentCard key={c.id} comment={c} orgUrl={orgUrl} />
            ))}
          </Space>
        )}
      </Section>

      <Section title={`Attachments (${item.attachments.length})`}>
        {item.attachments.length === 0 ? (
          <Text type="secondary">No attachments.</Text>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            {item.attachments.map((a) => (
              <AttachmentCard key={a.url} attachment={a} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Relations">
        <RelationGroup label="Linked work items" rels={grouped.workItems} />
        <RelationGroup label="Pull requests" rels={grouped.pullRequests} />
        <RelationGroup label="Commits" rels={grouped.commits} />
        <RelationGroup label="Branches" rels={grouped.branches} />
        <RelationGroup label="Other" rels={grouped.other} />
      </Section>
    </Space>
  );
}

interface MetaRow {
  label: string;
  value: React.ReactNode;
}
function MetaStrip({
  item,
  states,
  onChangeState,
}: {
  item: WorkItemDetail;
  states: string[];
  onChangeState: (next: string) => void | Promise<void>;
}) {
  // q7: state is editable. The Select shows the union of states the workflow
  // exposes; switching dispatches a PATCH. Read-only fallback to a Tag when
  // no states are loaded yet (offline / first paint).
  const stateValue =
    states.length === 0 ? (
      <Tag>{item.state}</Tag>
    ) : (
      <Select
        size="small"
        value={item.state}
        onChange={(next) => void onChangeState(next)}
        style={{ minWidth: 160 }}
        options={Array.from(new Set([item.state, ...states]))
          .filter(Boolean)
          .map((s) => ({ value: s, label: s }))}
      />
    );
  const rows: (MetaRow | null)[] = [
    { label: 'State', value: stateValue },
    item.assigned_to ? { label: 'Assigned', value: <Tag color="blue">{item.assigned_to}</Tag> } : null,
    item.created_by
      ? {
          label: 'Created',
          value: (
            <Text type="secondary">
              {item.created_by}
              {item.created_date ? ` · ${formatDate(item.created_date)}` : ''}
            </Text>
          ),
        }
      : null,
    item.iteration_path ? { label: 'Iteration', value: <Text type="secondary">{item.iteration_path}</Text> } : null,
    item.area_path ? { label: 'Area', value: <Text type="secondary">{item.area_path}</Text> } : null,
    item.priority != null ? { label: 'Priority', value: <Tag>P{item.priority}</Tag> } : null,
    item.severity ? { label: 'Severity', value: <Tag color="orange">{item.severity}</Tag> } : null,
    item.story_points != null
      ? { label: 'Story points', value: <Tag color="purple">{item.story_points}</Tag> }
      : null,
    item.effort != null ? { label: 'Effort', value: <Tag color="cyan">{item.effort}</Tag> } : null,
  ];
  const visible = rows.filter((r): r is MetaRow => r !== null);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 8,
        padding: 12,
        borderRadius: 6,
        background: 'rgba(99,102,241,0.08)',
      }}
    >
      {visible.map((r) => (
        <div key={r.label}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {r.label.toUpperCase()}
          </Text>
          <div style={{ marginTop: 2 }}>{r.value}</div>
        </div>
      ))}
      {item.tags.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            TAGS
          </Text>
          <div style={{ marginTop: 2 }}>
            {item.tags.map((t) => (
              <Tag key={t} color="purple">
                {t}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Title level={5} style={{ marginBottom: 8 }}>
        {title}
      </Title>
      {children}
    </div>
  );
}

function SanitizedHtml({ html, orgUrl }: { html: string; orgUrl: string }) {
  return (
    <div
      className="azure-html"
      style={{ fontSize: 14, lineHeight: 1.6 }}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html, orgUrl) }}
    />
  );
}

function CommentCard({ comment, orgUrl }: { comment: WorkItemComment; orgUrl: string }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.18)',
      }}
    >
      <Space style={{ marginBottom: 6 }}>
        <Avatar size={22}>{(comment.created_by[0] ?? '?').toUpperCase()}</Avatar>
        <Text strong style={{ fontSize: 13 }}>
          {comment.created_by || 'Unknown'}
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {formatDate(comment.created_date)}
          {comment.modified_date ? ` · edited` : ''}
        </Text>
      </Space>
      <SanitizedHtml html={comment.text_html} orgUrl={orgUrl} />
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: { name: string; url: string; size?: number } }) {
  const isImage = IMAGE_EXT.test(attachment.name) || IMAGE_EXT.test(attachment.url);
  const isVideo = VIDEO_EXT.test(attachment.name) || VIDEO_EXT.test(attachment.url);
  const proxied = `/api/azure/attachment?url=${encodeURIComponent(attachment.url)}`;
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.18)',
      }}
    >
      {isImage ? (
        <AntImage
          src={proxied}
          alt={attachment.name}
          width="100%"
          style={{ borderRadius: 4, maxHeight: 180, objectFit: 'cover' }}
        />
      ) : isVideo ? (
        <video
          controls
          src={proxied}
          style={{ width: '100%', borderRadius: 4, maxHeight: 180 }}
        />
      ) : (
        <div
          style={{
            height: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(128,128,128,0.06)',
            borderRadius: 4,
            fontSize: 28,
            color: 'rgba(128,128,128,0.8)',
          }}
        >
          <FileOutlined />
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <Text style={{ fontSize: 12, display: 'block', wordBreak: 'break-all' }}>
          {attachment.name}
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {typeof attachment.size === 'number'
            ? `${(attachment.size / 1024).toFixed(1)} KB`
            : ''}
          {' · '}
          <Link href={proxied} target="_blank">
            Download
          </Link>
        </Text>
      </div>
    </div>
  );
}

function RelationGroup({ label, rels }: { label: string; rels: WorkItemRelation[] }) {
  if (rels.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {label} ({rels.length})
      </Text>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {rels.map((r) => {
          const labelText = r.target_id ? `#${r.target_id}` : decodeArtifactLabel(r.url);
          return (
            <Tooltip key={r.url} title={r.url}>
              <Space size={6}>
                <Tag style={{ marginInlineEnd: 0 }}>{r.rel}</Tag>
                <Text style={{ fontSize: 12 }}>{labelText}</Text>
              </Space>
            </Tooltip>
          );
        })}
      </Space>
    </div>
  );
}

/* ----------------------------- connect modal ---------------------------- */

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
        <Form.Item label="Org URL" help="e.g. https://dev.azure.com/contoso">
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
              Needs <Text code>Work Items: Read</Text> + <Text code>Code: Read</Text> for
              commit/PR links. Stored in <Text code>~/.aifleet/secrets.env</Text>{' '}
              (chmod 600).
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

/* ----------------------------- helpers ---------------------------- */

function buildQuery(
  f: {
    type?: string[];
    state?: string[];
    assigned_to?: string;
    iteration_path?: string;
    tag?: string;
    search?: string;
  },
  page: number,
  pageSize: number,
): string {
  const p = new URLSearchParams();
  if (f.type && f.type.length > 0) p.set('type', f.type.join(','));
  if (f.state && f.state.length > 0) p.set('state', f.state.join(','));
  if (f.assigned_to) p.set('assigned_to', f.assigned_to);
  if (f.iteration_path) p.set('iteration_path', f.iteration_path);
  if (f.tag) p.set('tag', f.tag);
  if (f.search) p.set('search', f.search);
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** r4: build the web URL Azure renders this work item at. `detail.url` is the
 *  REST endpoint (`.../_apis/wit/workItems/123`) which 404s for humans. The
 *  proper deep link lives at `<org>/<project>/_workitems/edit/<id>`. */
function azureWebUrl(conn: AzureConnectionState | undefined, id: number): string {
  if (!conn) return '#';
  const org = conn.org_url.replace(/\/+$/, '');
  return `${org}/${encodeURIComponent(conn.project)}/_workitems/edit/${id}`;
}
