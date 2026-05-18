import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon — never bundle it; load it from
  // node_modules at runtime in the Node.js server. Server-side reads of
  // ~/.aifleet/state.db go through it.
  serverExternalPackages: ['better-sqlite3'],
  // This is one package inside a pnpm workspace; pin the file-tracing root to
  // the repo so Next doesn't mis-infer it from the single root lockfile.
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
};

export default nextConfig;
