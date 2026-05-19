'use client';
// Per-row memory actions (pin / edit lesson JSON / delete). shadcn Buttons →
// Antd. window.prompt/confirm kept (local tool, faithful to v1); errors via
// the Antd message context.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Space, Tooltip } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';

export function MemoryActions({
  id,
  pinned,
  lesson,
}: {
  id: string;
  pinned: boolean;
  lesson: unknown;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<Response>): Promise<void> {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space size={4}>
      <Tooltip title={pinned ? 'Unpin' : 'Pin'}>
        <Button
          size="small"
          disabled={busy}
          icon={pinned ? <PushpinFilled /> : <PushpinOutlined />}
          onClick={() =>
            run(() =>
              fetch(`/api/memory/${id}/pin`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ pinned: !pinned }),
              }),
            )
          }
        />
      </Tooltip>
      <Tooltip title="Edit lesson JSON">
        <Button
          size="small"
          disabled={busy}
          icon={<EditOutlined />}
          onClick={() => {
            const next = window.prompt('Edit lesson JSON', JSON.stringify(lesson));
            if (next == null) return;
            let parsed: unknown;
            try {
              parsed = JSON.parse(next);
            } catch {
              message.error('Not valid JSON');
              return;
            }
            void run(() =>
              fetch(`/api/memory/${id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ lesson: parsed }),
              }),
            );
          }}
        />
      </Tooltip>
      <Tooltip title="Delete">
        <Button
          size="small"
          danger
          disabled={busy}
          icon={<DeleteOutlined />}
          onClick={() => {
            if (window.confirm('Delete this memory?')) {
              void run(() => fetch(`/api/memory/${id}`, { method: 'DELETE' }));
            }
          }}
        />
      </Tooltip>
    </Space>
  );
}
