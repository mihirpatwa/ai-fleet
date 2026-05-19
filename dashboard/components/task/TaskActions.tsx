'use client';
// Cancel / retry. shadcn Buttons → Antd Buttons; errors via the App message
// context instead of inline text. Proxies to the daemon, then router.refresh.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Space } from 'antd';
import { StopOutlined, RedoOutlined } from '@ant-design/icons';
import type { TaskStatus } from '@/lib/types';

const TERMINAL: TaskStatus[] = ['done', 'failed', 'cancelled'];

export function TaskActions({ id, status }: { id: string; status: TaskStatus }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function act(action: 'cancel' | 'retry'): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      message.success(`Task ${action === 'cancel' ? 'cancelled' : 'requeued'}`);
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space>
      {!TERMINAL.includes(status) && (
        <Button icon={<StopOutlined />} loading={busy} onClick={() => act('cancel')}>
          Cancel
        </Button>
      )}
      {status === 'failed' && (
        <Button icon={<RedoOutlined />} loading={busy} onClick={() => act('retry')}>
          Retry
        </Button>
      )}
    </Space>
  );
}
