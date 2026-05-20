// Client-side mirror of daemon/src/providers/types.ts. Kept duplicated so the
// dashboard can import without server-only DAEMON dependencies leaking in.
export type ProviderName = 'claude' | 'codex';
export type AuthMethod = 'api_key' | 'local';

export interface ProviderCapability {
  toolGate: boolean;
  mcp: boolean;
  agentLoop: boolean;
  streaming: boolean;
}

export interface ProviderMeta {
  name: ProviderName;
  display_name: string;
  logo: string;
  tagline: string;
  available: boolean;
  reason?: string;
  auth_methods: AuthMethod[];
  capabilities: ProviderCapability;
}

export interface ProviderState {
  name: ProviderName | null;
  connected: boolean;
  auth: AuthMethod | null;
  validated_at: string | null;
  error: string | null;
}
