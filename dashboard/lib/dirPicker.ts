'use client';
// Phase 14/15: cross-browser directory picker.
//   1. Daemon native picker (Phase 15) — works on every browser because the
//      OS dialog renders on the daemon host (osascript / zenity / PowerShell).
//   2. Chromium showDirectoryPicker — kept as a Chromium-only secondary path so
//      a user can opt into it via drag-and-drop, and as a fallback if the
//      daemon dialog is unavailable (headless host).
//   3. Typed-path modal — universal manual entry, used when (1) and (2) fail.
// The chosen handle is cached in IndexedDB for the Chromium path so it
// survives sessions; the daemon resolves it to an absolute path via lib/resolve.
import { get, set, del } from 'idb-keyval';

// Minimal FS Access typings (no DOM lib for these in tsconfig).
type Perm = 'granted' | 'denied' | 'prompt';
export interface DirHandle {
  name: string;
  kind: 'directory';
  keys(): AsyncIterableIterator<string>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<Perm>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<Perm>;
}

export interface ResolveSuccess {
  status: 'success';
  absolute_path: string;
  recently_used: boolean;
}
export interface ResolveMultiple {
  status: 'multiple';
  candidates: { absolute_path: string; last_modified: string }[];
}
export interface ResolveNotFound {
  status: 'not_found';
  error: string;
  suggest_fallback: true;
}
export type ResolveResp = ResolveSuccess | ResolveMultiple | ResolveNotFound;

export type PickOutcome =
  | { kind: 'resolved'; handle?: DirHandle; path: string; name: string }
  | { kind: 'candidates'; handle?: DirHandle; name: string; candidates: ResolveMultiple['candidates'] }
  | { kind: 'fallback'; name?: string; error?: string }
  | { kind: 'cancelled' };

const IDB_KEY = 'aifleet:dir-handles';

interface Cached {
  name: string;
  handle: DirHandle;
  path?: string;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export interface NativeCapability {
  available: boolean;
  tool?: string;
  reason?: string;
}
/** Probe the daemon native picker (osascript / zenity / PowerShell). */
export async function nativePickerCapability(): Promise<NativeCapability> {
  try {
    const r = await fetch('/api/native-picker/capability');
    if (!r.ok) return { available: false, reason: `daemon responded ${r.status}` };
    return (await r.json()) as NativeCapability;
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : 'daemon unreachable',
    };
  }
}

export function supportsHandleDrop(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof DataTransferItem !== 'undefined' &&
    'getAsFileSystemHandle' in DataTransferItem.prototype
  );
}

export async function getCachedHandles(): Promise<Cached[]> {
  try {
    return (await get<Cached[]>(IDB_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function cacheHandle(name: string, handle: DirHandle, path?: string): Promise<void> {
  try {
    const all = (await getCachedHandles()).filter((c) => c.name !== name);
    all.unshift({ name, handle, ...(path ? { path } : {}) });
    await set(IDB_KEY, all.slice(0, 20));
  } catch {
    /* IndexedDB unavailable — non-fatal */
  }
}

export async function clearCachedHandles(): Promise<void> {
  try {
    await del(IDB_KEY);
  } catch {
    /* ignore */
  }
}

/** Query (and optionally request) read permission for a cached handle. */
export async function handlePermission(h: DirHandle, request = false): Promise<Perm> {
  const opts = { mode: 'read' as const };
  try {
    const q = h.queryPermission ? await h.queryPermission(opts) : 'granted';
    if (q === 'granted' || !request || !h.requestPermission) return q;
    return await h.requestPermission(opts);
  } catch {
    return 'denied';
  }
}

async function topNames(handle: DirHandle, max = 100): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const name of handle.keys()) {
      out.push(name);
      if (out.length >= max) break;
    }
  } catch {
    /* permission/iter error → empty fingerprint */
  }
  return out;
}

async function resolveOnDaemon(body: unknown): Promise<ResolveResp> {
  const res = await fetch('/api/resolve-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ResolveResp;
}

/** Resolve a typed/pasted absolute path (fallback modal). */
export async function resolveTypedPath(
  typePath: string,
): Promise<{ path?: string; error?: string }> {
  try {
    const r = await resolveOnDaemon({ type_path: typePath });
    if (r.status === 'success') return { path: r.absolute_path };
    return { error: r.status === 'not_found' ? r.error : 'could not resolve path' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'request failed' };
  }
}

/** Resolve an already-granted cached handle (e.g. re-grant flow / drop). */
export async function resolveHandle(handle: DirHandle): Promise<PickOutcome> {
  const entries = await topNames(handle);
  let r: ResolveResp;
  try {
    r = await resolveOnDaemon({ hint_name: handle.name, hint_entries: entries });
  } catch (e) {
    return { kind: 'fallback', name: handle.name, error: e instanceof Error ? e.message : 'failed' };
  }
  if (r.status === 'success') {
    await cacheHandle(handle.name, handle, r.absolute_path);
    return { kind: 'resolved', handle, path: r.absolute_path, name: handle.name };
  }
  if (r.status === 'multiple') {
    return { kind: 'candidates', handle, name: handle.name, candidates: r.candidates };
  }
  return { kind: 'fallback', name: handle.name, error: r.error };
}

/** Phase-15 native picker: ask the daemon to open the host's OS dialog. */
async function pickViaDaemon(): Promise<PickOutcome | null> {
  let r: Response;
  try {
    r = await fetch('/api/native-picker', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'directory' }),
    });
  } catch {
    return null; // daemon unreachable → caller tries the next strategy
  }
  if (r.status === 503) return null; // unavailable (headless / no tool)
  const body = (await r.json().catch(() => ({}))) as {
    path?: string;
    cancelled?: boolean;
    error?: string;
  };
  if (body.cancelled) return { kind: 'cancelled' };
  if (body.path) {
    const name = body.path.split(/[\\/]/).pop() ?? body.path;
    return { kind: 'resolved', path: body.path, name };
  }
  return null;
}

/**
 * Open a native folder dialog. Strategy (in order):
 *   1. Daemon native picker — works on every browser; the dialog renders on
 *      the daemon host (Mac/Linux/Windows).
 *   2. Chromium showDirectoryPicker — secondary, browser-only, returns a
 *      handle we resolve to an abs-path via lib/resolve.
 *   3. Fallback — caller opens the typed-path modal.
 */
export async function pickDirectory(): Promise<PickOutcome> {
  const viaDaemon = await pickViaDaemon();
  if (viaDaemon) return viaDaemon;

  if (!supportsDirectoryPicker()) return { kind: 'fallback' };
  let handle: DirHandle;
  try {
    handle = await (
      window as unknown as {
        showDirectoryPicker(o: object): Promise<DirHandle>;
      }
      // No startIn → the OS dialog opens at the last-used location (kept via
      // `id`) and the user can navigate anywhere — any folder or subfolder.
    ).showDirectoryPicker({ mode: 'read', id: 'aifleet-project' });
  } catch {
    return { kind: 'cancelled' }; // AbortError on cancel
  }
  return resolveHandle(handle);
}
