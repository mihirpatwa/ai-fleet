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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  ClearOutlined,
  EditOutlined,
  FileOutlined,
  ReloadOutlined,
  RocketOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { jsonFetcher } from '@/lib/models';
import { useActiveProject } from '@/lib/useActiveProject';
import { useGoalModal } from '@/lib/stores/useGoalModal';
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
const PDF_EXT = /\.pdf(\?|$)/i;

export function WorkItemsView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { message } = App.useApp();

  // s5: every filter + page/size lives in the URL so a refresh / share keeps
  // the view. `filters` is a getter over sp; setters write back through
  // pushQuery so the browser back-button works too.
  const filters = useMemo(() => readFiltersFromSp(sp), [sp]);
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = clampPageSize(Number(sp.get('pageSize')) || 25);
  const openId = sp.get('open') ? Number(sp.get('open')) : null;

  const setSp = useCallback(
    (mut: (next: URLSearchParams) => void): void => {
      const next = new URLSearchParams(sp.toString());
      mut(next);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, sp],
  );

  const setFilters = (
    updater: (prev: typeof filters) => typeof filters,
  ): void => {
    const nextFilters = updater(filters);
    setSp((q) => {
      // Reset to page 1 on any filter change.
      q.delete('page');
      writeFiltersToSp(q, nextFilters);
    });
  };
  const setPage = (p: number): void =>
    setSp((q) => {
      if (p <= 1) q.delete('page');
      else q.set('page', String(p));
    });
  const setPageSize = (n: number): void =>
    setSp((q) => {
      if (n === 25) q.delete('pageSize');
      else q.set('pageSize', String(n));
    });
  const setOpenId = (id: number | null): void =>
    setSp((q) => {
      if (id == null) q.delete('open');
      else q.set('open', String(id));
    });

  const [connectOpen, setConnectOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  // t6: keyboard navigation in the table. j/k step the row cursor, Enter
  // opens the drawer, Esc closes it. Cursor index is 1-based to match the
  // visible list; -1 means "no cursor yet".
  const [cursor, setCursor] = useState(-1);
  const { current: activeProject } = useActiveProject();
  const showGoalModal = useGoalModal((s) => s.show);

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

  // t1: full team-member roster for the assignee dropdown — better than
  // deriving from the current page only.
  const { data: usersData } = useSWR<{ users: string[] }>(
    conn?.connected ? '/api/azure/users' : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const listKey = conn?.connected
    ? `/api/azure/work-items?${buildQuery(filters, page - 1, pageSize)}`
    : null;
  const {
    data: listData,
    error: listError,
    isLoading,
    isValidating,
    mutate: mutateList,
  } = useSWR<{
    items: WorkItemSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>(listKey, jsonFetcher, { revalidateOnFocus: false });
  const items = listData?.items ?? [];
  const total = listData?.total ?? items.length;

  // Derive assignee / iteration / tag options from the loaded items so the
  // dropdowns only contain values that actually exist in the project. t1
  // prefers the full team-member roster when available; we union both to
  // cover users who are members but not assigned to anything on this page.
  const assigneeOptions = useMemo(() => {
    const fromItems = items
      .map((i) => i.assigned_to)
      .filter((v): v is string => !!v);
    const fromTeams = usersData?.users ?? [];
    return Array.from(new Set([...fromTeams, ...fromItems]))
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [items, usersData?.users]);
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
  const { data: commentsData, mutate: mutateComments } = useSWR<{ comments: WorkItemComment[] }>(
    openId && conn?.connected ? `/api/azure/work-items/${openId}/comments` : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  // q7: PATCH the work item's System.State and refresh both the drawer detail
  // and the list (so the table shows the new state immediately).
  async function patchItem(
    id: number,
    body: {
      state?: string;
      assigned_to?: string | null;
      title?: string;
      tags?: string;
    },
    note: string,
  ): Promise<void> {
    try {
      const res = await fetch(`/api/azure/work-items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const respBody = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // s7: translate the most-common Azure failures into something a user
        // can act on instead of a raw daemon error string.
        const raw = respBody.error ?? `daemon returned ${res.status}`;
        throw new Error(friendlyAzureError(raw));
      }
      message.success(`#${id} ${note}`);
      await mutateDetail();
      if (listKey) void fetch(listKey).catch(() => undefined);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'patch failed');
    }
  }

  function changeState(id: number, nextState: string): Promise<void> {
    return patchItem(id, { state: nextState }, `→ ${nextState}`);
  }
  function changeAssignee(id: number, next: string | null): Promise<void> {
    return patchItem(id, { assigned_to: next }, next ? `assigned to ${next}` : 'unassigned');
  }
  function changeTitle(id: number, next: string): Promise<void> {
    return patchItem(id, { title: next }, 'title updated');
  }
  function changeTags(id: number, next: string[]): Promise<void> {
    return patchItem(id, { tags: next.join('; ') }, 'tags updated');
  }

  // q8/s8: post a new Discussion comment. Returns the refreshed comments
  // array so the drawer rerenders without a full detail refetch.
  async function postComment(id: number, text: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/azure/work-items/${id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        comments?: WorkItemComment[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `daemon returned ${res.status}`);
      message.success('Comment posted');
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'comment failed');
      return false;
    }
  }

  function sendAsGoal(item: WorkItemDetail): void {
    // t10: open the header SubmitGoal modal directly via the shared store —
    // no router navigation, no sessionStorage handoff. The modal mounts in
    // AppShell so this works from any route.
    showGoalModal({
      goal: workItemToGoal(item),
      source: `Azure ${item.type} #${item.id}`,
    });
  }

  /** s9: skip the modal and submit directly with the current active project +
   *  orchestrator agent. Useful for quick "ship this ticket now" flows. */
  async function runNow(item: WorkItemDetail): Promise<void> {
    if (!activeProject) {
      message.warning('Pick an active project in the header first.');
      return;
    }
    const prompt = workItemToGoal(item);
    setRunBusy(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: prompt,
          project_root: activeProject,
          agent: 'orchestrator',
          effort: 'medium',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `daemon returned ${res.status}`);
      message.success(`Spawned ${item.type} #${item.id}`);
      if (body.id) router.push(`/task/${body.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setRunBusy(false);
    }
  }

  // t6: keyboard handler — bind to document so anywhere on /work-items the
  // shortcuts work. Bail when focus is inside an editable element (textarea,
  // input, contenteditable) so we don't fight typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tgt = e.target as HTMLElement | null;
      const editable =
        !!tgt &&
        (tgt.tagName === 'INPUT' ||
          tgt.tagName === 'TEXTAREA' ||
          tgt.isContentEditable);
      if (editable) return;
      if (e.key === 'j') {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c < 0 ? 0 : c + 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c < 0 ? 0 : c - 1));
      } else if (e.key === 'Enter') {
        if (cursor >= 0 && cursor < items.length) {
          e.preventDefault();
          const item = items[cursor];
          if (item) setOpenId(item.id);
        }
      } else if (e.key === 'Escape') {
        if (openId !== null) {
          e.preventDefault();
          setOpenId(null);
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cursor, openId]);

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
        <Button icon={<ClearOutlined />} onClick={() => setFilters(() => ({}))}>
          Clear
        </Button>
        <Tooltip title="Refresh from Azure now">
          <Button
            icon={<ReloadOutlined />}
            loading={isValidating}
            onClick={() => void mutateList()}
          />
        </Tooltip>
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
        rowClassName={(_, idx) => (idx === cursor ? 'wi-cursor-row' : '')}
        onRow={(_, idx) => ({
          onMouseEnter: () => {
            if (typeof idx === 'number') setCursor(idx);
          },
        })}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100, 200],
          showTotal: (n, range) => `${range[0]}–${range[1]} of ${n}`,
          onChange: (p, s) => {
            if (s !== pageSize) setPageSize(s);
            if (p !== page) setPage(p);
          },
        }}
        // q3: horizontal scroll keeps the table usable at 375px wide.
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText:
            'No work items match these filters. Clear filters or widen the search.',
        }}
      />
      <style jsx global>{`
        .wi-cursor-row > td {
          background: rgba(99, 102, 241, 0.12) !important;
        }
      `}</style>

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
              <Tooltip
                title={
                  activeProject
                    ? `Spawn an orchestrator now against ${activeProject}`
                    : 'Pick an active project in the header first.'
                }
              >
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={runBusy}
                  disabled={!activeProject}
                  onClick={() => void runNow(detail)}
                >
                  Run now
                </Button>
              </Tooltip>
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
            assigneeOptions={assigneeOptions.map((o) => o.value)}
            onChangeState={(next) => changeState(detail.id, next)}
            onChangeAssignee={(next) => changeAssignee(detail.id, next)}
            onChangeTitle={(next) => changeTitle(detail.id, next)}
            onChangeTags={(next) => changeTags(detail.id, next)}
            onPostComment={async (text) => {
              const ok = await postComment(detail.id, text);
              if (ok) await mutateComments();
              return ok;
            }}
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
  assigneeOptions,
  onChangeState,
  onChangeAssignee,
  onChangeTitle,
  onChangeTags,
  onPostComment,
}: {
  item: WorkItemDetail;
  comments: WorkItemComment[];
  orgUrl: string;
  states: string[];
  assigneeOptions: string[];
  onChangeState: (next: string) => void | Promise<void>;
  onChangeAssignee: (next: string | null) => void | Promise<void>;
  onChangeTitle: (next: string) => void | Promise<void>;
  onChangeTags: (next: string[]) => void | Promise<void>;
  onPostComment: (text: string) => Promise<boolean>;
}) {
  const grouped = groupRelations(item.relations);
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <TitleEditor item={item} onChangeTitle={onChangeTitle} />
      <MetaStrip
        item={item}
        states={states}
        assigneeOptions={assigneeOptions}
        onChangeState={onChangeState}
        onChangeAssignee={onChangeAssignee}
        onChangeTags={onChangeTags}
      />

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
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {comments.length === 0 ? (
            <Text type="secondary">No comments yet.</Text>
          ) : (
            comments.map((c) => <CommentCard key={c.id} comment={c} orgUrl={orgUrl} />)
          )}
          <ComposeComment onPost={onPostComment} />
        </Space>
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
function TitleEditor({
  item,
  onChangeTitle,
}: {
  item: WorkItemDetail;
  onChangeTitle: (next: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  // Reset draft whenever the item changes (drawer reopened on different row).
  if (!editing && draft !== item.title) setDraft(item.title);
  if (!editing) {
    return (
      <Space size={6} style={{ flexWrap: 'wrap' }}>
        <Text strong style={{ fontSize: 15 }}>
          {item.title}
        </Text>
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => setEditing(true)}
        />
      </Space>
    );
  }
  const save = async (): Promise<void> => {
    const next = draft.trim();
    if (next && next !== item.title) await onChangeTitle(next);
    setEditing(false);
  };
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={() => void save()}
      />
      <Button type="primary" onClick={() => void save()}>
        Save
      </Button>
      <Button onClick={() => setEditing(false)}>Cancel</Button>
    </Space.Compact>
  );
}

function MetaStrip({
  item,
  states,
  assigneeOptions,
  onChangeState,
  onChangeAssignee,
  onChangeTags,
}: {
  item: WorkItemDetail;
  states: string[];
  assigneeOptions: string[];
  onChangeState: (next: string) => void | Promise<void>;
  onChangeAssignee: (next: string | null) => void | Promise<void>;
  onChangeTags: (next: string[]) => void | Promise<void>;
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
  // s8: assigned_to is editable. Free-text Select w/ derived options from the
  // current page; clearing the value calls Azure's "remove" op.
  const assignedValue = (
    <Select<string[]>
      size="small"
      style={{ minWidth: 220 }}
      value={item.assigned_to ? [item.assigned_to] : []}
      placeholder="Unassigned"
      allowClear
      showSearch
      mode="tags"
      maxCount={1}
      onChange={(values) =>
        void onChangeAssignee(values && values.length > 0 ? (values[0] ?? null) : null)
      }
      options={assigneeOptions.map((a) => ({ value: a, label: a }))}
    />
  );
  const rows: (MetaRow | null)[] = [
    { label: 'State', value: stateValue },
    { label: 'Assigned', value: assignedValue },
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
      <div style={{ gridColumn: '1 / -1' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          TAGS
        </Text>
        <div style={{ marginTop: 2 }}>
          <Select<string[]>
            mode="tags"
            size="small"
            value={item.tags}
            placeholder="Add tags…"
            style={{ width: '100%' }}
            onChange={(next) => void onChangeTags(next)}
            tokenSeparators={[',', ';']}
          />
        </div>
      </div>
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

function ComposeComment({
  onPost,
}: {
  onPost: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 6,
        border: '1px dashed rgba(128,128,128,0.32)',
      }}
    >
      <Input.TextArea
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder="Add a comment…  (Cmd/Ctrl+Enter to post)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim()) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Space style={{ marginTop: 6 }}>
        <Button
          type="primary"
          size="small"
          loading={busy}
          disabled={!text.trim()}
          onClick={() => void submit()}
        >
          Post
        </Button>
        <Text type="secondary" style={{ fontSize: 11 }}>
          Cmd/Ctrl+Enter posts. Comments appear immediately after Azure responds.
        </Text>
      </Space>
    </div>
  );
  async function submit(): Promise<void> {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await onPost(text.trim());
    if (ok) setText('');
    setBusy(false);
  }
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
  const isPdf = PDF_EXT.test(attachment.name) || PDF_EXT.test(attachment.url);
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
      ) : isPdf ? (
        // r3: PDF preview via iframe. The daemon proxy adds the PAT, so the
        // browser's native PDF viewer renders without prompting.
        <iframe
          title={attachment.name}
          src={proxied}
          style={{ width: '100%', height: 220, border: 0, borderRadius: 4 }}
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

interface UrlFilters {
  type?: string[];
  state?: string[];
  assigned_to?: string;
  iteration_path?: string;
  tag?: string;
  search?: string;
}

/** s5: read filter state from the URL searchParams. Multi-value filters are
 *  comma-separated; trim/empty values are dropped. */
function readFiltersFromSp(sp: URLSearchParams): UrlFilters {
  const get = (k: string): string | undefined => sp.get(k) ?? undefined;
  const csv = (k: string): string[] | undefined => {
    const v = sp.get(k);
    if (!v) return undefined;
    const arr = v.split(',').map((s) => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  };
  return {
    ...(csv('type') ? { type: csv('type')! } : {}),
    ...(csv('state') ? { state: csv('state')! } : {}),
    ...(get('assigned_to') ? { assigned_to: get('assigned_to')! } : {}),
    ...(get('iteration_path') ? { iteration_path: get('iteration_path')! } : {}),
    ...(get('tag') ? { tag: get('tag')! } : {}),
    ...(get('search') ? { search: get('search')! } : {}),
  };
}

function writeFiltersToSp(sp: URLSearchParams, f: UrlFilters): void {
  const setOrDel = (k: string, v?: string | string[]): void => {
    if (Array.isArray(v)) {
      if (v.length === 0) sp.delete(k);
      else sp.set(k, v.join(','));
    } else if (!v) sp.delete(k);
    else sp.set(k, v);
  };
  setOrDel('type', f.type);
  setOrDel('state', f.state);
  setOrDel('assigned_to', f.assigned_to);
  setOrDel('iteration_path', f.iteration_path);
  setOrDel('tag', f.tag);
  setOrDel('search', f.search);
}

function clampPageSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 25;
  if (n > 200) return 200;
  return n;
}

/** s7: rephrase common Azure error strings into actionable copy. */
function friendlyAzureError(raw: string): string {
  if (/\b403\b/.test(raw))
    return 'Azure rejected the change — your PAT lacks the required scope (Work Items: Read & Write) or the workflow forbids this transition.';
  if (/\b401\b/.test(raw))
    return 'Azure returned 401 — the PAT has expired or been revoked. Reconnect in Settings.';
  if (/\b404\b/.test(raw))
    return 'Azure returned 404 — the work item may have been deleted in the project.';
  if (/cannot be changed/i.test(raw))
    return 'Azure refused the state transition — choose a state allowed by the workflow.';
  return raw;
}

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
