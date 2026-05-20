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
    display_name: 'Codex CLI',
    logo: '/providers/openai.svg',
    tagline: 'OpenAI — coming in phase 18c. Awaits a sandbox adapter so the phase-8 denylist still holds.',
    available: false,
    reason: 'Sandbox adapter pending — disabled until then.',
    auth_methods: ['api_key'],
    capabilities: { toolGate: false, mcp: false, agentLoop: true, streaming: true },
  },
  {
    name: 'openai',
    display_name: 'OpenAI Responses',
    logo: '/providers/openai.svg',
    tagline: 'Direct Responses API — needs a DIY agent loop + tool schema.',
    available: false,
    reason: 'Adapter not implemented yet.',
    auth_methods: ['api_key'],
    capabilities: { toolGate: false, mcp: false, agentLoop: false, streaming: true },
  },
];

export function findProvider(name: ProviderName): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.name === name);
}
