'use client';
// t4: read + flush the daemon's in-process Azure attachment cache. Lives
// inside the Settings "Caches" section.
import useSWR from 'swr';
import { App, Button, Progress, Space, Typography } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { jsonFetcher } from '@/lib/models';

const { Text } = Typography;

interface Stats {
  entries: number;
  bytes: number;
  maxBytes: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function AttachmentCacheCard() {
  const { message } = App.useApp();
  const { data, mutate, isValidating } = useSWR<Stats>('/api/azure/attachment-cache', jsonFetcher, {
    revalidateOnFocus: false,
  });

  async function clear(): Promise<void> {
    try {
      const res = await fetch('/api/azure/attachment-cache', { method: 'DELETE' });
      const body = (await res.json()) as { cleared?: number };
      if (!res.ok) throw new Error(`daemon returned ${res.status}`);
      message.success(`Cleared ${body.cleared ?? 0} cached attachments`);
      await mutate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'clear failed');
    }
  }

  const entries = data?.entries ?? 0;
  const bytes = data?.bytes ?? 0;
  const max = data?.maxBytes ?? 1;
  const pct = Math.round((bytes / max) * 100);

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap>
        <Text>
          {entries} entr{entries === 1 ? 'y' : 'ies'} · {fmtBytes(bytes)} / {fmtBytes(max)}
        </Text>
      </Space>
      <Progress percent={pct} showInfo={false} size="small" />
      <Space>
        <Button
          icon={<ReloadOutlined />}
          loading={isValidating}
          onClick={() => void mutate()}
        >
          Refresh
        </Button>
        <Button icon={<DeleteOutlined />} danger onClick={() => void clear()}>
          Clear cache
        </Button>
      </Space>
    </Space>
  );
}
