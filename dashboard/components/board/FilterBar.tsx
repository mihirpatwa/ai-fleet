'use client';
// Goal + agent filters. Native <select> → Antd Select; still URL-param driven
// so the server board component does the actual filtering (SSR source-of-truth).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select, Space, Typography } from 'antd';

export interface GoalOption {
  id: string;
  title: string;
}

export function FilterBar({ goals, agents }: { goals: GoalOption[]; agents: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value?: string): void {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <Space wrap size={16} style={{ marginBottom: 16 }}>
      <Space size={8}>
        <Typography.Text type="secondary">Goal</Typography.Text>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="All goals"
          style={{ minWidth: 220 }}
          value={params.get('root') || undefined}
          onChange={(v?: string) => set('root', v)}
          options={goals.map((g) => ({
            value: g.id,
            label: g.title.length > 48 ? g.title.slice(0, 47) + '…' : g.title,
          }))}
        />
      </Space>
      <Space size={8}>
        <Typography.Text type="secondary">Agent</Typography.Text>
        <Select
          allowClear
          placeholder="All agents"
          style={{ minWidth: 160 }}
          value={params.get('agent') || undefined}
          onChange={(v?: string) => set('agent', v)}
          options={agents.map((a) => ({ value: a, label: a }))}
        />
      </Space>
    </Space>
  );
}
