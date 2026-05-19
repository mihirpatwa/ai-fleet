// Phase 14: server-side directory resolver for the browser folder picker.
// Two modes: a typed absolute path (Firefox/Safari fallback) or a
// handle-derived {name, top-level entries} fingerprint that we match against
// the user's filesystem. EVERY returned path is run through the phase-8 hard
// denylist (sandbox.hardDenied) — ~/.ssh, /etc, /var, ~/.aws, … can never be
// returned even if it would otherwise match.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FleetDb } from './db.js';
import { expandHome, hardDenied } from './sandbox.js';

export interface ResolveBody {
  hint_name?: string;
  hint_entries?: string[];
  type_path?: string;
}

export type ResolveResult =
  | { status: 'success'; absolute_path: string; recently_used: boolean }
  | { status: 'multiple'; candidates: { absolute_path: string; last_modified: string }[] }
  | { status: 'not_found'; error: string; suggest_fallback: true };

// Don't descend these — huge, and never a project root the user means.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'vendor',
  '.cache',
  'Library',
  '.Trash',
]);
// Deeper + wider so an arbitrary picked folder/subfolder still fingerprint-
// matches (the FS Access handle only exposes name + entries, never an abspath).
const MAX_DEPTH = 6;
const MAX_VISITED = 25000;
const MAX_CANDIDATES = 12;

export const DEFAULT_SEARCH_ROOTS = [
  '~',
  '~/Documents',
  '~/Desktop',
  '~/Downloads',
  '~/Projects',
  '~/projects',
  '~/Developer',
  '~/dev',
  '~/code',
  '~/work',
  '~/repos',
  '~/src',
  '/workspace',
  '/srv',
];

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function recentlyUsed(db: FleetDb, abs: string): boolean {
  try {
    return (
      db.raw
        .prepare('SELECT 1 AS x FROM recent_projects WHERE absolute_path = ?')
        .get(abs) !== undefined
    );
  } catch {
    return false;
  }
}

/** Top-level entry names of a directory (best-effort, empty on error). */
function topEntries(dir: string): string[] {
  try {
    return readdirSync(dir).slice(0, 200);
  } catch {
    return [];
  }
}

function overlapFraction(a: string[], b: string[]): number {
  if (b.length === 0) return a.length === 0 ? 1 : 0;
  const setA = new Set(a);
  const hit = b.filter((x) => setA.has(x)).length;
  return hit / b.length;
}

/** Depth-limited search for directories named `name` that fingerprint-match. */
function searchByName(
  roots: string[],
  name: string,
  hintEntries: string[],
): { absolute_path: string; last_modified: string }[] {
  const found: { absolute_path: string; last_modified: string }[] = [];
  let visited = 0;

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_VISITED || found.length >= MAX_CANDIDATES) return;
    visited++;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const child = join(dir, e.name);
      if (hardDenied(child)) continue;
      if (e.name === name && overlapFraction(topEntries(child), hintEntries) >= 0.6) {
        try {
          found.push({
            absolute_path: child,
            last_modified: statSync(child).mtime.toISOString(),
          });
        } catch {
          /* skip unreadable */
        }
        if (found.length >= MAX_CANDIDATES) return;
      }
      walk(child, depth + 1);
    }
  };

  for (const r of roots) {
    const abs = resolve(expandHome(r));
    if (existsSync(abs) && isDir(abs) && !hardDenied(abs)) walk(abs, 1);
  }
  // De-dupe (roots can overlap, e.g. ~ and ~/Projects).
  const seen = new Set<string>();
  return found.filter((f) => (seen.has(f.absolute_path) ? false : seen.add(f.absolute_path)));
}

export function resolvePath(
  db: FleetDb,
  roots: string[],
  body: ResolveBody,
): { code: number; result: ResolveResult } {
  // ---- typed path (fallback) ----
  if (typeof body.type_path === 'string' && body.type_path.trim()) {
    const abs = resolve(expandHome(body.type_path.trim()));
    if (!existsSync(abs) || !isDir(abs)) {
      return {
        code: 400,
        result: {
          status: 'not_found',
          error: `not a directory: ${abs}`,
          suggest_fallback: true,
        },
      };
    }
    const denied = hardDenied(abs);
    if (denied) {
      return {
        code: 400,
        result: { status: 'not_found', error: `path not allowed — ${denied}`, suggest_fallback: true },
      };
    }
    return {
      code: 200,
      result: { status: 'success', absolute_path: abs, recently_used: recentlyUsed(db, abs) },
    };
  }

  // ---- handle mode ----
  const name = body.hint_name?.trim();
  if (!name) {
    return {
      code: 400,
      result: { status: 'not_found', error: 'hint_name or type_path required', suggest_fallback: true },
    };
  }
  const hintEntries = Array.isArray(body.hint_entries) ? body.hint_entries.map(String) : [];
  const searchRoots = roots.length ? roots : DEFAULT_SEARCH_ROOTS;
  const matches = searchByName(searchRoots, name, hintEntries);

  if (matches.length === 1) {
    const abs = matches[0]!.absolute_path;
    return {
      code: 200,
      result: { status: 'success', absolute_path: abs, recently_used: recentlyUsed(db, abs) },
    };
  }
  if (matches.length > 1) {
    return { code: 200, result: { status: 'multiple', candidates: matches } };
  }
  return {
    code: 200,
    result: {
      status: 'not_found',
      error: `no directory named "${name}" found in the search roots`,
      suggest_fallback: true,
    },
  };
}
