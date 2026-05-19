'use client';
// React-19 compat patch MUST be imported before antd renders.
import '@ant-design/v5-patch-for-react-19';
import { useEffect, useState, type ReactNode } from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { StyleProvider } from '@ant-design/cssinjs';
import { App as AntApp, ConfigProvider } from 'antd';
import { useTheme } from '@/lib/stores/useTheme';
import { themeConfigFor, type Resolved } from '@/lib/theme';

/** Tracks the OS color scheme and updates live when the user flips it. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function Providers({ children }: { children: ReactNode }) {
  const mode = useTheme((s) => s.mode);
  const systemDark = useSystemDark();
  const resolved: Resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Once the persisted store is live, correct whatever the pre-paint inline
  // script guessed (it can't see a "system" flip that happened while away).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  }, [resolved]);

  return (
    <AntdRegistry>
      <StyleProvider layer>
        <ConfigProvider theme={themeConfigFor(resolved)}>
          {/* antd App: message/notification/modal context (used by toasts). */}
          <AntApp style={{ minHeight: '100vh' }}>{children}</AntApp>
        </ConfigProvider>
      </StyleProvider>
    </AntdRegistry>
  );
}
