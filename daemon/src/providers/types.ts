// Phase 18: AI provider abstraction layer.
//
// Stage 1 wires up the metadata + connection plumbing (first-run modal,
// credentials, status chip in the header) but the runtime is still
// Claude-only — spawn.ts continues to import @anthropic-ai/claude-agent-sdk.
// Future stages will introduce per-provider adapters that emit a common
// AIEvent stream and let the daemon swap engines.

export type ProviderName = 'claude' | 'codex';

export type AuthMethod = 'api_key' | 'local';

export interface ProviderCapability {
  /** Multi-agent sub-tool gate (Claude SDK canUseTool). */
  toolGate: boolean;
  /** First-class MCP server support. */
  mcp: boolean;
  /** Native multi-turn agent loop without DIY orchestration. */
  agentLoop: boolean;
  /** Streaming token output. */
  streaming: boolean;
}

export interface ProviderMeta {
  name: ProviderName;
  display_name: string;
  logo: string;            // relative URL on the dashboard (/providers/<file>.svg)
  tagline: string;
  /** false → modal renders the card disabled with `reason` shown. */
  available: boolean;
  reason?: string;
  /** Methods exposed in the connect form. */
  auth_methods: AuthMethod[];
  capabilities: ProviderCapability;
}

export interface ProviderState {
  name: ProviderName | null;
  connected: boolean;
  auth: AuthMethod | null;
  /** Last successful validation timestamp (ISO). */
  validated_at: string | null;
  /** Reason the current provider failed validation, if any. */
  error: string | null;
}

export interface ConnectRequest {
  name: ProviderName;
  auth: AuthMethod;
  /** Required when auth === 'api_key' */
  api_key?: string;
}

export interface ConnectResult {
  ok: boolean;
  state: ProviderState;
  error?: string;
}
