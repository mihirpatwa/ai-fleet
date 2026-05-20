// v1: smoke render for ProviderChip. The full SubmitGoal + WorkItemsView
// trees pull in too many mocks (Next router, SWR, Antd ConfigProvider) for
// a useful smoke; we cover those via pure-function tests + the daemon
// endpoint tests instead. ProviderChip is small and self-contained.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderChip } from '@/components/Provider/ProviderChip';
import type { ProviderMeta, ProviderState } from '@/lib/provider';

const claudeMeta: ProviderMeta = {
  name: 'claude',
  display_name: 'Claude',
  logo: '/providers/anthropic.svg',
  tagline: 'Anthropic',
  available: true,
  auth_methods: ['api_key', 'local'],
  capabilities: { toolGate: true, mcp: true, agentLoop: true, streaming: true },
};

function state(over: Partial<ProviderState> = {}): ProviderState {
  return {
    name: 'claude',
    connected: true,
    auth: 'api_key',
    validated_at: '2025-01-01',
    error: null,
    ...over,
  };
}

describe('ProviderChip', () => {
  it('returns null when no provider is set', () => {
    const { container } = render(
      <ProviderChip state={null} providers={[claudeMeta]} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the display name when connected', () => {
    const { getByText } = render(
      <ProviderChip state={state()} providers={[claudeMeta]} onChange={() => {}} />,
    );
    expect(getByText('Claude')).toBeTruthy();
  });

  it('shows error status (red dot via aria-label) when state.error is set', () => {
    const { getByLabelText } = render(
      <ProviderChip
        state={state({ error: 'bad token' })}
        providers={[claudeMeta]}
        onChange={() => {}}
      />,
    );
    expect(getByLabelText('AI provider error')).toBeTruthy();
  });
});
