'use client';
// Header global-default model picker. Options grouped by tier (Opus / Sonnet /
// Haiku) with the context window + $/Mtok shown muted on the right. Selecting
// one sets the GLOBAL DEFAULT (PUT /models/agent/default); per-agent overrides
// live in Settings/.agents.
import { useEffect } from 'react';
import useSWR from 'swr';
import { App, Select, Tooltip, Typography } from 'antd';
import {
  groupByTier,
  ctxLabel,
  priceLabel,
  jsonFetcher,
  type ActiveModels,
  type ModelInfo,
} from '@/lib/models';
import { useModel } from '@/lib/stores/useModel';

const TIP = 'This is the default model for new tasks; per-agent overrides can be set in Settings.';

export function ModelPicker({ width = 200 }: { width?: number }) {
  const { message } = App.useApp();
  const setModel = useModel((s) => s.setModel);
  const { data: models } = useSWR<ModelInfo[]>('/api/models', jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: active, mutate } = useSWR<ActiveModels>('/api/models/active', jsonFetcher, {
    revalidateOnFocus: false,
  });

  // Mirror the daemon default into the store so SubmitGoal can default to it.
  useEffect(() => {
    if (active?.default) setModel(active.default);
  }, [active?.default, setModel]);

  const options = groupByTier(models ?? []).map((g) => ({
    label: g.tier,
    title: g.tier,
    options: g.models.map((m) => ({
      value: m.id,
      name: m.display_name,
      label: (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span>{m.display_name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {ctxLabel(m.context_window)} · {priceLabel(m.pricing)}
          </Typography.Text>
        </div>
      ),
    })),
  }));

  async function onChange(id: string): Promise<void> {
    try {
      const res = await fetch('/api/models/agent/default', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: id }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Request failed (${res.status})`);
      }
      setModel(id);
      await mutate();
      message.success('Default model updated');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <Tooltip title={TIP}>
      <Select
        value={active?.default}
        loading={!models || !active}
        onChange={onChange}
        options={options}
        optionLabelProp="name"
        placeholder="model"
        style={{ minWidth: width, flex: '0 0 auto' }}
        size="middle"
      />
    </Tooltip>
  );
}
