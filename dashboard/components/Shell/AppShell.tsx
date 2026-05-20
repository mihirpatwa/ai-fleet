'use client';
// Responsive chrome: Header (logo, project picker, [+ New goal], provider
// chip, theme), collapsible Sider (auto-hides below lg → hamburger→Drawer),
// Content well. Server pages render inside <Content>; data still flows SSR +
// SSE refresh. Phase 18: app blocks behind the first-run provider modal until
// an AI provider is connected.
import { useState, type DragEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  Button,
  Drawer,
  Grid,
  Layout,
  Menu,
  Segmented,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  DatabaseOutlined,
  FlagOutlined,
  MenuOutlined,
  ProfileOutlined,
  RobotOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useTheme, type ThemeMode } from '@/lib/stores/useTheme';
import { useActiveProject } from '@/lib/useActiveProject';
import { useStream } from '@/lib/useStream';
import { resolveHandle, supportsHandleDrop, type DirHandle } from '@/lib/dirPicker';
import { jsonFetcher } from '@/lib/models';
import type { ProviderMeta, ProviderState } from '@/lib/provider';
import { Live } from '@/components/live';
import { ProjectPicker } from '@/components/Header/ProjectPicker';
import { SubmitGoal } from '@/components/Header/SubmitGoal';
import { ProviderModal } from '@/components/Provider/ProviderModal';
import { ProviderChip } from '@/components/Provider/ProviderChip';

const { Header, Sider, Content } = Layout;

const NAV = [
  { key: '/', label: 'Board', icon: <AppstoreOutlined /> },
  { key: '/goals', label: 'Goals', icon: <FlagOutlined /> },
  { key: '/work-items', label: 'Work items', icon: <ProfileOutlined /> },
  { key: '/agents', label: 'Agents', icon: <RobotOutlined /> },
  { key: '/memory', label: 'Memory', icon: <DatabaseOutlined /> },
  { key: '/security', label: 'Security', icon: <SafetyOutlined /> },
  { key: '/schedules', label: 'Schedules', icon: <ScheduleOutlined /> },
  { key: '/settings', label: 'Settings', icon: <SettingOutlined /> },
];

const THEME_OPTS: { label: string; value: ThemeMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

/** Longest-prefix match so /task/abc still highlights nothing-but-Board etc. */
function selectedKey(pathname: string): string {
  if (pathname === '/') return '/';
  const hit = NAV.filter((n) => n.key !== '/' && pathname.startsWith(n.key)).sort(
    (a, b) => b.key.length - a.key.length,
  )[0];
  return hit?.key ?? '/';
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();

  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const { current: project, apply: applyProject } = useActiveProject();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);

  const { connected } = useStream();

  // Phase 18: provider list (static metadata) + current connection state.
  // The first-run modal blocks until `providerState.connected` is true; once
  // it is, we expose the chip and let the user reopen via Settings or chip.
  const { data: providers } = useSWR<{ providers: ProviderMeta[] }>(
    '/api/providers',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const { data: providerState, mutate: mutateProvider } = useSWR<ProviderState>(
    '/api/provider',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const showFirstRun =
    providerState !== undefined && !providerState.connected && !providerModalOpen;
  const showChangeModal = providerModalOpen;

  const isDesktop = !!screens.lg;
  const sel = selectedKey(pathname);

  // Drag a folder onto the header (Chromium): resolve it like a pick.
  const onHeaderDragOver = (e: DragEvent): void => {
    if (supportsHandleDrop()) e.preventDefault();
  };
  async function onHeaderDrop(e: DragEvent): Promise<void> {
    if (!supportsHandleDrop()) return;
    e.preventDefault();
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      const getHandle = (
        item as unknown as { getAsFileSystemHandle?: () => Promise<DirHandle | null> }
      ).getAsFileSystemHandle;
      const h = getHandle ? await getHandle.call(item) : null;
      if (h && h.kind === 'directory') {
        const o = await resolveHandle(h);
        if (o.kind === 'resolved') applyProject(o.path);
        return;
      }
    }
  }

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={[sel]}
      items={NAV}
      style={{ borderInlineEnd: 0 }}
      onClick={({ key }) => {
        setDrawerOpen(false);
        router.push(key);
      }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          // Wrap instead of clipping on narrow screens (mobile-header fix);
          // height grows to fit the wrapped rows.
          minHeight: 56,
          height: 'auto',
          lineHeight: 'normal',
          padding: '8px 12px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          rowGap: 8,
          borderBottom: '1px solid rgba(128,128,128,0.18)',
        }}
        onDragOver={onHeaderDragOver}
        onDrop={onHeaderDrop}
      >
        {!isDesktop && (
          <Button
            type="text"
            aria-label="Open menu"
            icon={<MenuOutlined />}
            onClick={() => setDrawerOpen(true)}
          />
        )}

        <Space size={8} style={{ flex: '0 0 auto' }}>
          <Tooltip title={connected ? 'Live stream connected' : 'Live stream disconnected'}>
            <span
              aria-label={connected ? 'Connected' : 'Disconnected'}
              style={{
                display: 'inline-block',
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: connected ? '#10b981' : '#ef4444',
              }}
            />
          </Tooltip>
          <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
            ai-fleet
          </Typography.Text>
        </Space>

        <ProjectPicker />

        <span style={{ flex: '1 1 auto' }} />

        <SubmitGoal project={project} />

        {/* t17: hide the provider chip on xs to de-crowd the mobile header.
            Settings still shows it. */}
        {screens.sm && (
          <ProviderChip
            state={providerState ?? null}
            providers={providers?.providers ?? []}
            onChange={() => setProviderModalOpen(true)}
          />
        )}

        {/* Hidden on xs to de-crowd the mobile header — also in /settings. */}
        {screens.sm && (
          <Segmented<ThemeMode>
            options={THEME_OPTS}
            value={mode}
            onChange={setMode}
            size="middle"
          />
        )}
      </Header>

      <Layout>
        <Sider
          breakpoint="lg"
          collapsedWidth={0}
          width={220}
          trigger={null}
          style={{ borderInlineEnd: '1px solid rgba(128,128,128,0.18)' }}
        >
          {menu}
        </Sider>

        <Content
          style={{
            padding: screens.md ? 24 : 12,
            minWidth: 0,
            minHeight: 'calc(100vh - 56px)',
          }}
        >
          {children}
        </Content>
      </Layout>

      <Drawer
        title="ai-fleet"
        placement="left"
        width={240}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        {menu}
      </Drawer>

      <Live />

      <ProviderModal
        open={showFirstRun || showChangeModal}
        providers={providers?.providers ?? []}
        initialName={showChangeModal ? (providerState?.name ?? null) : null}
        onConnected={async (state) => {
          setProviderModalOpen(false);
          await mutateProvider(state, { revalidate: false });
        }}
        // First-run is blocking → no onClose. Change-mode is dismissable.
        {...(showChangeModal ? { onClose: () => setProviderModalOpen(false) } : {})}
      />
    </Layout>
  );
}
