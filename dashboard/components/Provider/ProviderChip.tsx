'use client';
// Phase 18 header chip: shows the currently-connected provider with its logo
// and a click action to swap (opens the Provider modal preselecting the
// current one). Hidden when no provider is configured — the first-run modal
// occupies the screen in that case.
import Image from 'next/image';
import { Button, Space, Tooltip, Typography } from 'antd';
import type { ProviderMeta, ProviderState } from '@/lib/provider';

const { Text } = Typography;

export function ProviderChip({
  state,
  providers,
  onChange,
}: {
  state: ProviderState | null;
  providers: ProviderMeta[];
  onChange: () => void;
}) {
  if (!state?.name || !state.connected) return null;
  const meta = providers.find((p) => p.name === state.name);
  if (!meta) return null;

  const tip = state.error
    ? `Error: ${state.error}`
    : `${meta.display_name} · ${state.auth === 'local' ? 'local login' : 'API key'}`;

  return (
    <Tooltip title={tip}>
      <Button
        size="middle"
        onClick={onChange}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          paddingInline: 10,
          height: 32,
        }}
        aria-label="Change AI provider"
      >
        <Image src={meta.logo} alt={meta.display_name} width={18} height={18} unoptimized />
        <Text style={{ fontSize: 13 }}>{meta.display_name}</Text>
      </Button>
    </Tooltip>
  );
}
