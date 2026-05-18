import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pinning root + config here stops Vitest from walking UP the tree and
// loading the host project's vite.config.ts (ai-fleet is nested inside it).
// `forks` pool keeps the better-sqlite3 native addon happy.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  // Inline (empty) PostCSS config so Vite does NOT walk up the tree and pick
  // up the host project's postcss.config.js / tailwind. This is a pure Node
  // library — no CSS pipeline.
  css: { postcss: {} },
  test: {
    root: here,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    css: false,
  },
});
