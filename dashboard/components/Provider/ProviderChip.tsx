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
  if (!state?.name) return null;
  const meta = providers.find((p) => p.name === state.name);
  if (!meta) return null;

  // t8: surface validation/connection failures inline. Red dot when an error
  // is sticking around even though state.name is set, amber when the
  // disconnect bookkeeping is mid-flight (name present but connected:false
  // with no specific error).
  const hasError = !state.connected || !!state.error;
  const tip = state.error
    ? `Error: ${state.error}`
    : state.connected
      ? `${meta.display_name} · ${state.auth === 'local' ? 'local login' : 'API key'}`
      : `${meta.display_name} · not connected — click to fix`;

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
          borderColor: hasError ? '#ef4444' : undefined,
        }}
        aria-label="Change AI provider"
      >
        <Image src={meta.logo} alt={meta.display_name} width={18} height={18} unoptimized />
        <Text style={{ fontSize: 13 }}>{meta.display_name}</Text>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: hasError ? '#ef4444' : '#10b981',
            marginLeft: 2,
          }}
        />
      </Button>
    </Tooltip>
  );
}
