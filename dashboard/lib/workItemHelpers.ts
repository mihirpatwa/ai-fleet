// v11: pure helpers extracted from WorkItemsView so unit tests can import
// them without pulling the whole component tree (and its 'use client'
// React surface) into jsdom.

export interface UrlFilters {
  type?: string[];
  state?: string[];
  assigned_to?: string;
  iteration_path?: string;
  tag?: string;
  search?: string;
}

/** s5: read filter state from URLSearchParams. CSV for multi-values. */
export function readFiltersFromSp(sp: URLSearchParams): UrlFilters {
  const get = (k: string): string | undefined => sp.get(k) ?? undefined;
  const csv = (k: string): string[] | undefined => {
    const v = sp.get(k);
    if (!v) return undefined;
    const arr = v.split(',').map((s) => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  };
  return {
    ...(csv('type') ? { type: csv('type')! } : {}),
    ...(csv('state') ? { state: csv('state')! } : {}),
    ...(get('assigned_to') ? { assigned_to: get('assigned_to')! } : {}),
    ...(get('iteration_path') ? { iteration_path: get('iteration_path')! } : {}),
    ...(get('tag') ? { tag: get('tag')! } : {}),
    ...(get('search') ? { search: get('search')! } : {}),
  };
}

export function writeFiltersToSp(sp: URLSearchParams, f: UrlFilters): void {
  const setOrDel = (k: string, v?: string | string[]): void => {
    if (Array.isArray(v)) {
      if (v.length === 0) sp.delete(k);
      else sp.set(k, v.join(','));
    } else if (!v) sp.delete(k);
    else sp.set(k, v);
  };
  setOrDel('type', f.type);
  setOrDel('state', f.state);
  setOrDel('assigned_to', f.assigned_to);
  setOrDel('iteration_path', f.iteration_path);
  setOrDel('tag', f.tag);
  setOrDel('search', f.search);
}

export function clampPageSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 25;
  if (n > 200) return 200;
  return n;
}

/** s7: rephrase common Azure error strings into actionable copy. */
export function friendlyAzureError(raw: string): string {
  if (/\b403\b/.test(raw))
    return 'Azure rejected the change — your PAT lacks the required scope (Work Items: Read & Write) or the workflow forbids this transition.';
  if (/\b401\b/.test(raw))
    return 'Azure returned 401 — the PAT has expired or been revoked. Reconnect in Settings.';
  if (/\b404\b/.test(raw))
    return 'Azure returned 404 — the work item may have been deleted in the project.';
  if (/cannot be changed/i.test(raw))
    return 'Azure refused the state transition — choose a state allowed by the workflow.';
  return raw;
}

export function buildQuery(
  f: UrlFilters,
  page: number,
  pageSize: number,
): string {
  const p = new URLSearchParams();
  if (f.type && f.type.length > 0) p.set('type', f.type.join(','));
  if (f.state && f.state.length > 0) p.set('state', f.state.join(','));
  if (f.assigned_to) p.set('assigned_to', f.assigned_to);
  if (f.iteration_path) p.set('iteration_path', f.iteration_path);
  if (f.tag) p.set('tag', f.tag);
  if (f.search) p.set('search', f.search);
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  return p.toString();
}
