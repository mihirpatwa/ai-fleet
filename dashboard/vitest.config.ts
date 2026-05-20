import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
  },
  // v1: TSX in tests needs the automatic JSX runtime so each file doesn't
  // have to `import React`. Matches Next.js's default JSX transform.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
