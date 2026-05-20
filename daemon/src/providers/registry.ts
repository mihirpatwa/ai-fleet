// Phase 18: provider catalog. Stage 1 only Claude is `available: true`; the
// other entries surface on the first-run modal as disabled cards with a
// "coming soon" reason so the user knows the abstraction is intentional.
import type { ProviderMeta, ProviderName } from './types.js';

export const PROVIDERS: ProviderMeta[] = [
  {
    name: 'claude',
    display_name: 'Claude',
    logo: '/providers/anthropic.svg',
    tagline: 'Anthropic — multi-agent, MCP-native, sandboxed tool gate.',
    available: true,
    auth_methods: ['api_key', 'local'],
    capabilities: { toolGate: true, mcp: true, agentLoop: true, streaming: true },
  },
  {
    name: 'codex',
    display_name: 'OpenAI Codex',
    logo: '/providers/openai.svg',
    tagline:
      'OpenAI GPT-5 / Codex CLI — would dispatch via `codex exec`. Held back because Codex has no per-tool gate equivalent to Claude SDK `canUseTool`, so the phase-8 sandbox denylist can\'t be enforced without an OS-level wrapper.',
    available: false,
    reason:
      'Needs an OS-level sandbox wrapper (firejail on Linux / sandbox-exec on macOS / no native option on Windows). See ARCHITECTURE.md "Codex roadmap".',
    auth_methods: ['api_key'],
    capabilities: { toolGate: false, mcp: false, agentLoop: true, streaming: true },
  },
];

export function findProvider(name: ProviderName): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.name === name);
}
