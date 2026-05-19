// Antd v5 design tokens (phase 11). Two ThemeConfig objects share one token
// base and differ only by algorithm + a few background overrides. Role/status/
// severity hues are theme-agnostic accents (legible on light *and* dark) used
// for Tags across the board, goals, agents, security and memory pages.
import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

const { defaultAlgorithm, darkAlgorithm } = theme;

/** Tokens shared by both themes. */
const baseToken = {
  colorPrimary: '#6366f1', // indigo
  borderRadius: 8,
  // Spec intent is Inter; --font-inter is the next/font face (app/layout.tsx).
  // The literal "Inter, system-ui, sans-serif" stays as the fallback chain.
  fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
  wireframe: false,
} as const;

/** Component tuning shared by both themes; per-theme backgrounds added below. */
const baseComponents: NonNullable<ThemeConfig['components']> = {
  // Subtle (transparent) card header — no heavy filled bar.
  Card: { headerBg: 'transparent' },
  Tabs: { itemActiveColor: baseToken.colorPrimary },
};

// cssVar + hashed:false: emit token CSS variables with stable (non-theme-
// hashed) component selectors, so flipping algorithm/tokens on the client
// actually restyles SSR-rendered components (the dark/system blocker) instead
// of leaving the server's light styles stuck.
export const lightTheme: ThemeConfig = {
  algorithm: defaultAlgorithm,
  cssVar: true,
  hashed: false,
  token: { ...baseToken },
  components: {
    ...baseComponents,
    Layout: { headerBg: '#ffffff', siderBg: '#ffffff' },
    Table: { headerBg: '#f5f5f7' },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: darkAlgorithm,
  cssVar: true,
  hashed: false,
  token: {
    ...baseToken,
    colorBgLayout: '#0b0d12',
    colorBgContainer: '#13161d',
  },
  components: {
    ...baseComponents,
    Layout: { headerBg: '#13161d', siderBg: '#0e1117' },
    Table: { headerBg: '#1a1e27' },
  },
};

/**
 * The resolved Layout background per theme. The inline anti-FOUC script and
 * ConfigProvider must agree on these or the first paint flashes. (#f5f5f5 is
 * Antd's default light colorBgLayout; dark matches darkTheme's override.)
 */
export const LAYOUT_BG = { light: '#f5f5f5', dark: '#0b0d12' } as const;

export type Resolved = 'light' | 'dark';

export function themeConfigFor(resolved: Resolved): ThemeConfig {
  return resolved === 'dark' ? darkTheme : lightTheme;
}

/**
 * Agent → accent hex (phase-11 palette). Core roles get a distinct hue; the
 * supporting roles share a neutral slate. Used as a Tag tint/border, so the
 * same value reads well on both light and dark surfaces.
 */
const ROLE_GRAY = '#94a3b8';
export const ROLE_COLORS: Record<string, string> = {
  orchestrator: '#a78bfa',
  coder: '#14b8a6',
  reviewer: '#f97316',
  tester: '#f59e0b',
  'security-auditor': '#ef4444',
  planner: ROLE_GRAY,
  researcher: ROLE_GRAY,
  debugger: ROLE_GRAY,
  devops: ROLE_GRAY,
  'doc-writer': ROLE_GRAY,
  scribe: ROLE_GRAY,
  retrospector: ROLE_GRAY,
};

export function roleColor(agent: string): string {
  return ROLE_COLORS[agent] ?? ROLE_GRAY;
}

/** Task status → accent hex (board columns, goal/task badges). */
export const STATUS_COLORS: Record<string, string> = {
  queued: ROLE_GRAY,
  running: '#0ea5e9',
  review: '#8b5cf6',
  blocked: '#f59e0b',
  done: '#10b981',
  failed: '#ef4444',
  cancelled: ROLE_GRAY,
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? ROLE_GRAY;
}

/** Security finding severity → accent hex. */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  med: '#f59e0b',
  low: ROLE_GRAY,
};

export function severityColor(severity: string): string {
  return SEVERITY_COLORS[severity] ?? ROLE_GRAY;
}
