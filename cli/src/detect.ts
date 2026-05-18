// Stack detection for the React profile. Reads a project's package.json,
// lockfile and config/layout to produce a typed picture of its conventions so
// `ai-fleet init` can render an accurate CLAUDE.md. Best-effort and never
// throws: anything undetectable degrades to null/unknown.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface StackDetection {
  framework: 'vite' | 'next' | 'cra' | 'remix' | 'unknown';
  framework_version: string;
  typescript: { present: boolean; strict: boolean };
  state_lib: 'zustand' | 'redux-toolkit' | 'jotai' | 'context' | null;
  styling: 'tailwind' | 'css-modules' | 'styled-components' | 'vanilla-extract' | 'sass' | null;
  data_fetching: 'tanstack-query' | 'swr' | 'rtk-query' | null;
  forms: 'react-hook-form' | 'formik' | null;
  validation: 'zod' | 'yup' | null;
  testing: {
    unit: 'vitest' | 'jest' | null;
    e2e: 'playwright' | 'cypress' | null;
    rtl: boolean;
  };
  router: 'react-router' | 'tanstack-router' | 'next-app' | 'next-pages' | null;
}

type Deps = Record<string, string>;

function readPkg(root: string): { deps: Deps; raw: Record<string, unknown> } {
  try {
    const raw = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      deps: {
        ...((raw['dependencies'] as Deps) ?? {}),
        ...((raw['devDependencies'] as Deps) ?? {}),
      },
      raw,
    };
  } catch {
    return { deps: {}, raw: {} };
  }
}

// String-aware JSONC to JSON. A regex cannot do this safely: tsconfig string
// values (path aliases, glob includes) legitimately contain comment-looking
// character pairs, so scan char by char and only strip comment syntax that
// appears outside of strings, then drop trailing commas.
function stripJsonc(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = false;
  let quote = '';
  while (i < n) {
    const c = src[i] as string;
    const d = i + 1 < n ? (src[i + 1] as string) : '';
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += d;
        i += 2;
        continue;
      }
      if (c === quote) inStr = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.replace(/,(\s*[}\]])/g, '$1'); // trailing commas (comments already gone)
}

function readJsonc(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(stripJsonc(readFileSync(path, 'utf8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanVersion(v: string | undefined): string {
  return (v ?? '').replace(/^[\^~>=<\s]*/, '') || 'unknown';
}

function existsAny(root: string, names: string[]): boolean {
  return names.some((n) => existsSync(join(root, n)));
}

/** Bounded recursive walk (skips vendored/build dirs). */
function walk(root: string, max = 4000): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo']);
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length && out.length < max) {
    const { dir, depth } = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.storybook') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name) && depth < 5) stack.push({ dir: full, depth: depth + 1 });
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

export function detectStack(projectRoot: string): StackDetection {
  const { deps } = readPkg(projectRoot);
  const has = (n: string): boolean => n in deps;
  const ver = (n: string): string => cleanVersion(deps[n]);

  // framework
  let framework: StackDetection['framework'] = 'unknown';
  let framework_version = 'unknown';
  if (has('next')) {
    framework = 'next';
    framework_version = ver('next');
  } else if (has('@remix-run/react') || has('@remix-run/dev')) {
    framework = 'remix';
    framework_version = ver('@remix-run/react') || ver('@remix-run/dev');
  } else if (has('react-scripts')) {
    framework = 'cra';
    framework_version = ver('react-scripts');
  } else if (has('vite') && (has('@vitejs/plugin-react') || has('@vitejs/plugin-react-swc'))) {
    framework = 'vite';
    framework_version = ver('vite');
  } else if (has('vite') && has('react')) {
    framework = 'vite';
    framework_version = ver('vite');
  }

  // typescript
  const tsconfig = readJsonc(join(projectRoot, 'tsconfig.json'));
  const tsPresent = has('typescript') || existsSync(join(projectRoot, 'tsconfig.json'));
  const co = (tsconfig?.['compilerOptions'] ?? {}) as Record<string, unknown>;
  const tsStrict = co['strict'] === true;

  // state
  const state_lib: StackDetection['state_lib'] = has('zustand')
    ? 'zustand'
    : has('@reduxjs/toolkit')
      ? 'redux-toolkit'
      : has('jotai')
        ? 'jotai'
        : has('react')
          ? 'context'
          : null;

  // styling
  const files = walk(projectRoot);
  const hasCssModule = files.some((f) => /\.module\.(css|scss|sass)$/.test(f));
  const styling: StackDetection['styling'] =
    has('tailwindcss') || has('@tailwindcss/postcss')
      ? 'tailwind'
      : has('styled-components')
        ? 'styled-components'
        : has('@vanilla-extract/css')
          ? 'vanilla-extract'
          : hasCssModule
            ? 'css-modules'
            : has('sass') || has('node-sass')
              ? 'sass'
              : null;

  // data fetching
  const data_fetching: StackDetection['data_fetching'] = has('@tanstack/react-query')
    ? 'tanstack-query'
    : has('swr')
      ? 'swr'
      : has('@reduxjs/toolkit')
        ? 'rtk-query'
        : null;

  const forms: StackDetection['forms'] = has('react-hook-form')
    ? 'react-hook-form'
    : has('formik')
      ? 'formik'
      : null;

  const validation: StackDetection['validation'] = has('zod') ? 'zod' : has('yup') ? 'yup' : null;

  // testing
  const unit: StackDetection['testing']['unit'] = has('vitest')
    ? 'vitest'
    : has('jest') || existsAny(projectRoot, ['jest.config.js', 'jest.config.ts', 'jest.config.cjs'])
      ? 'jest'
      : null;
  const e2e: StackDetection['testing']['e2e'] =
    has('@playwright/test') || has('playwright') ? 'playwright' : has('cypress') ? 'cypress' : null;
  const rtl = has('@testing-library/react');

  // router
  const dirHas = (rel: string): boolean => existsSync(join(projectRoot, rel));
  let router: StackDetection['router'] = null;
  if (framework === 'next') {
    const appDir = dirHas('app') || dirHas('src/app');
    const pagesDir = dirHas('pages') || dirHas('src/pages');
    router = appDir ? 'next-app' : pagesDir ? 'next-pages' : 'next-app';
  } else if (has('@tanstack/react-router')) {
    router = 'tanstack-router';
  } else if (has('react-router-dom') || has('react-router')) {
    router = 'react-router';
  }

  return {
    framework,
    framework_version,
    typescript: { present: tsPresent, strict: tsStrict },
    state_lib,
    styling,
    data_fetching,
    forms,
    validation,
    testing: { unit, e2e, rtl },
    router,
  };
}

/** A short, bounded summary of the project's src/ layout for the profile. */
export function sampleStructure(projectRoot: string): string {
  const base = existsSync(join(projectRoot, 'src')) ? join(projectRoot, 'src') : projectRoot;
  const rel = base === projectRoot ? '.' : 'src';
  let dirs: string[] = [];
  try {
    dirs = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
      .sort();
  } catch {
    /* unreadable */
  }
  if (dirs.length === 0) return `- \`${rel}/\` (flat — no subdirectories detected)`;
  return dirs.map((d) => `- \`${rel}/${d}/\``).join('\n');
}
