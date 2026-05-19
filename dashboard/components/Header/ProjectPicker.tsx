'use client';
// Phase 14: header project picker. Replaces the static project Select.
// Sections: Recent (from /api/recent-projects), "Pick folder…" (native
// Chromium dialog via dirPicker), "Type path…" (fallback modal). A small
// indicator shows whether the native picker is available. Lapsed Chromium
// handles get a "re-grant" tag and re-prompt on click.
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { App, Input, Modal, Radio, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleTwoTone, WarningTwoTone } from '@ant-design/icons';
import { jsonFetcher } from '@/lib/models';
import { useActiveProject } from '@/lib/useActiveProject';
import {
  getCachedHandles,
  handlePermission,
  pickDirectory,
  resolveTypedPath,
  supportsDirectoryPicker,
  type DirHandle,
} from '@/lib/dirPicker';

interface RecentProject {
  absolutePath: string;
  name: string;
  submissionCount: number;
}

const PICK = '__pick__';
const TYPE = '__type__';

export function ProjectPicker() {
  const { message } = App.useApp();
  const { current, apply } = useActiveProject();
  const native = supportsDirectoryPicker();

  const { data: recents, mutate } = useSWR<RecentProject[]>(
    '/api/recent-projects?limit=10',
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  // Cached Chromium handles whose read permission lapsed → offer re-grant.
  const [handles, setHandles] = useState<Record<string, DirHandle>>({});
  const [regrant, setRegrant] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await getCachedHandles();
      if (!alive) return;
      const map: Record<string, DirHandle> = {};
      const need = new Set<string>();
      for (const c of cached) {
        map[c.path ?? c.name] = c.handle;
        if ((await handlePermission(c.handle)) !== 'granted') need.add(c.path ?? c.name);
      }
      if (alive) {
        setHandles(map);
        setRegrant(need);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [typeOpen, setTypeOpen] = useState(false);
  const [typeVal, setTypeVal] = useState('');
  const [typeErr, setTypeErr] = useState<string | null>(null);
  const [cands, setCands] = useState<string[]>([]);
  const [candPick, setCandPick] = useState<string>('');

  function applyAndRefresh(path: string): void {
    apply(path);
    void mutate();
  }

  async function onPick(): Promise<void> {
    const o = await pickDirectory();
    if (o.kind === 'cancelled') return;
    if (o.kind === 'resolved') return applyAndRefresh(o.path);
    if (o.kind === 'candidates') {
      setCands(o.candidates.map((c) => c.absolute_path));
      setCandPick(o.candidates[0]?.absolute_path ?? '');
      return;
    }
    // fallback: browser without the native picker, OR the folder couldn't be
    // fingerprint-matched. Prefill the typed modal with the folder name so the
    // user just completes its absolute path (works on any device/browser).
    if (o.error) message.info(o.error);
    setTypeErr(null);
    setTypeVal(o.name ? `~/${o.name}` : '');
    setTypeOpen(true);
  }

  async function onSelect(value: string): Promise<void> {
    if (value === PICK) return onPick();
    if (value === TYPE) {
      setTypeErr(null);
      setTypeVal('');
      setTypeOpen(true);
      return;
    }
    // a recent path — re-grant its handle first if Chromium permission lapsed
    if (regrant.has(value) && handles[value]) {
      const p = await handlePermission(handles[value]!, true);
      if (p === 'granted') {
        setRegrant((s) => {
          const n = new Set(s);
          n.delete(value);
          return n;
        });
      }
    }
    applyAndRefresh(value);
  }

  async function submitTyped(): Promise<void> {
    const v = typeVal.trim();
    if (!v) return;
    const r = await resolveTypedPath(v);
    if (r.path) {
      applyAndRefresh(r.path);
      setTypeOpen(false);
    } else {
      setTypeErr(r.error ?? 'could not resolve path');
    }
  }

  const options = [
    {
      label: 'Recent',
      options: (recents ?? []).map((r) => ({
        value: r.absolutePath,
        title: r.absolutePath,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {r.name}{' '}
              {regrant.has(r.absolutePath) && (
                <Tag color="orange" style={{ marginInlineStart: 4 }}>
                  re-grant
                </Tag>
              )}
            </span>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {r.absolutePath}
            </Typography.Text>
          </div>
        ),
      })),
    },
    {
      label: 'Folder',
      options: [
        { value: PICK, title: PICK, label: '📁 Pick folder…' },
        { value: TYPE, title: TYPE, label: '⌨ Type path…' },
      ],
    },
  ];

  return (
    <Space size={6} style={{ flex: '1 1 160px', minWidth: 160, maxWidth: 320 }}>
      <Tooltip
        title={
          native
            ? 'Native folder picker available (Chromium)'
            : 'Browser has no folder picker — use “Type path…”'
        }
      >
        {native ? (
          <CheckCircleTwoTone twoToneColor="#10b981" />
        ) : (
          <WarningTwoTone twoToneColor="#f59e0b" />
        )}
      </Tooltip>
      <Select
        showSearch
        placeholder="project"
        value={current || undefined}
        onSelect={onSelect}
        options={options}
        optionLabelProp="title"
        optionFilterProp="title"
        style={{ flex: 1, minWidth: 140 }}
        size="middle"
        notFoundContent="No recent projects"
      />

      <Modal
        title="Type or paste a project path"
        open={typeOpen}
        onOk={submitTyped}
        onCancel={() => setTypeOpen(false)}
        okText="Use folder"
      >
        <Input
          autoFocus
          placeholder="/abs/path/to/project  (or ~/Projects/foo)"
          value={typeVal}
          onChange={(e) => {
            setTypeVal(e.target.value);
            setTypeErr(null);
          }}
          onPressEnter={submitTyped}
          status={typeErr ? 'error' : undefined}
        />
        {typeErr && (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {typeErr}
          </Typography.Text>
        )}
      </Modal>

      <Modal
        title="Multiple folders matched — pick one"
        open={cands.length > 0}
        onOk={() => {
          if (candPick) applyAndRefresh(candPick);
          setCands([]);
        }}
        onCancel={() => setCands([])}
        okText="Use folder"
      >
        <Radio.Group
          value={candPick}
          onChange={(e) => setCandPick(e.target.value)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {cands.map((c) => (
            <Radio key={c} value={c} style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {c}
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
    </Space>
  );
}
