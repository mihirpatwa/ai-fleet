// Phase 18g: Azure DevOps REST client. Minimal — covers what the dashboard
// needs (connection probe, work-item list via WIQL, work-item detail with
// attachments/relations) without pulling in azure-devops-node-api (huge
// dep). PAT goes into Authorization: Basic <base64(":<PAT>")>; the daemon
// loads it from secrets.env (AZURE_DEVOPS_PAT) on boot.

import { Buffer } from 'node:buffer';
import type {
  ListFilter,
  WorkItemAttachment,
  WorkItemComment,
  WorkItemDetail,
  WorkItemRelation,
  WorkItemSummary,
} from './types.js';

const API_VERSION = '7.1';

function authHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`, 'utf8').toString('base64')}`;
}

function trimOrgUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function joinOrgProject(orgUrl: string, project: string): string {
  return `${trimOrgUrl(orgUrl)}/${encodeURIComponent(project)}`;
}

async function fetchJson<T>(url: string, pat: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(pat),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Azure ${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, pat: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(pat),
      Accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Azure ${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

/* ---------------------------- validation ---------------------------- */

/** Cheap "is this PAT good for this org/project?" probe. */
export async function validateConnection(
  orgUrl: string,
  project: string,
  pat: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await fetchJson<unknown>(
      `${joinOrgProject(orgUrl, project)}/_apis/wit/workitemtypes?api-version=${API_VERSION}`,
      pat,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' };
  }
}

/* ---------------------------- list / WIQL ---------------------------- */

interface WiqlResp {
  workItems?: Array<{ id: number }>;
}
interface WorkItemBatch {
  value: Array<{
    id: number;
    fields: Record<string, unknown>;
    url: string;
  }>;
}

function quoteWiqlStr(s: string): string {
  return s.replace(/'/g, "''");
}

function buildWiql(project: string, filter: ListFilter): string {
  const where: string[] = [`[System.TeamProject] = '${quoteWiqlStr(project)}'`];
  if (filter.type && filter.type.length > 0) {
    const list = filter.type.map((t) => `'${quoteWiqlStr(t)}'`).join(', ');
    where.push(`[System.WorkItemType] IN (${list})`);
  }
  if (filter.state && filter.state.length > 0) {
    const list = filter.state.map((t) => `'${quoteWiqlStr(t)}'`).join(', ');
    where.push(`[System.State] IN (${list})`);
  }
  if (filter.assigned_to) {
    where.push(`[System.AssignedTo] = '${quoteWiqlStr(filter.assigned_to)}'`);
  }
  if (filter.iteration_path) {
    where.push(`[System.IterationPath] UNDER '${quoteWiqlStr(filter.iteration_path)}'`);
  }
  if (filter.area_path) {
    where.push(`[System.AreaPath] UNDER '${quoteWiqlStr(filter.area_path)}'`);
  }
  if (filter.tag) {
    where.push(`[System.Tags] CONTAINS '${quoteWiqlStr(filter.tag)}'`);
  }
  if (filter.search) {
    where.push(`[System.Title] CONTAINS '${quoteWiqlStr(filter.search)}'`);
  }
  return (
    'SELECT [System.Id] FROM WorkItems WHERE ' +
    where.join(' AND ') +
    ' ORDER BY [System.ChangedDate] DESC'
  );
}

function summaryFromFields(id: number, fields: Record<string, unknown>, url: string): WorkItemSummary {
  const get = (k: string): string | null => (typeof fields[k] === 'string' ? (fields[k] as string) : null);
  const assigned = fields['System.AssignedTo'] as { displayName?: string } | undefined;
  return {
    id,
    type: get('System.WorkItemType') ?? 'Task',
    title: get('System.Title') ?? `#${id}`,
    state: get('System.State') ?? '',
    assigned_to: assigned?.displayName ?? null,
    iteration_path: get('System.IterationPath'),
    changed_date: get('System.ChangedDate') ?? '',
    url,
  };
}

export async function listWorkItems(
  orgUrl: string,
  project: string,
  pat: string,
  filter: ListFilter = {},
): Promise<WorkItemSummary[]> {
  const wiqlUrl = `${joinOrgProject(orgUrl, project)}/_apis/wit/wiql?api-version=${API_VERSION}`;
  const wiql = await postJson<WiqlResp>(wiqlUrl, pat, { query: buildWiql(project, filter) });
  const ids = (wiql.workItems ?? []).map((w) => w.id).slice(0, filter.limit ?? 100);
  if (ids.length === 0) return [];

  // Batch endpoint accepts up to 200 ids per request.
  const fields = [
    'System.Id',
    'System.WorkItemType',
    'System.Title',
    'System.State',
    'System.AssignedTo',
    'System.IterationPath',
    'System.ChangedDate',
  ].join(',');
  const url = `${trimOrgUrl(orgUrl)}/_apis/wit/workitems?ids=${ids.join(
    ',',
  )}&fields=${encodeURIComponent(fields)}&api-version=${API_VERSION}`;
  const body = await fetchJson<WorkItemBatch>(url, pat);
  return body.value.map((w) => summaryFromFields(w.id, w.fields, w.url));
}

/* ---------------------------- detail ---------------------------- */

interface WorkItemDetailResp {
  id: number;
  fields: Record<string, unknown>;
  url: string;
  relations?: Array<{
    rel: string;
    url: string;
    attributes?: Record<string, unknown>;
  }>;
}

function extractIdFromUrl(u: string): number | undefined {
  const m = /workItems\/(\d+)/i.exec(u);
  return m ? Number(m[1]) : undefined;
}

export async function getWorkItem(
  orgUrl: string,
  project: string,
  id: number,
  pat: string,
): Promise<WorkItemDetail> {
  const url = `${joinOrgProject(orgUrl, project)}/_apis/wit/workitems/${id}?$expand=all&api-version=${API_VERSION}`;
  const w = await fetchJson<WorkItemDetailResp>(url, pat);
  const f = w.fields;
  const summary = summaryFromFields(w.id, f, w.url);

  const attachments: WorkItemAttachment[] = [];
  const relations: WorkItemRelation[] = [];
  for (const r of w.relations ?? []) {
    if (r.rel === 'AttachedFile') {
      const attrs = (r.attributes ?? {}) as { name?: string; resourceSize?: number };
      attachments.push({
        name: attrs.name ?? r.url.split('/').pop() ?? 'attachment',
        url: r.url,
        ...(typeof attrs.resourceSize === 'number' ? { size: attrs.resourceSize } : {}),
      });
    } else {
      relations.push({
        rel: r.rel,
        ...(extractIdFromUrl(r.url) ? { target_id: extractIdFromUrl(r.url)! } : {}),
        url: r.url,
      });
    }
  }

  const tagsRaw = typeof f['System.Tags'] === 'string' ? (f['System.Tags'] as string) : '';
  const tags = tagsRaw
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

  const createdBy = f['System.CreatedBy'] as { displayName?: string } | undefined;
  return {
    ...summary,
    description_html: (f['System.Description'] as string) ?? null,
    acceptance_criteria_html:
      (f['Microsoft.VSTS.Common.AcceptanceCriteria'] as string) ?? null,
    repro_steps_html: (f['Microsoft.VSTS.TCM.ReproSteps'] as string) ?? null,
    system_history_html: (f['System.History'] as string) ?? null,
    tags,
    area_path: (f['System.AreaPath'] as string) ?? null,
    priority:
      typeof f['Microsoft.VSTS.Common.Priority'] === 'number'
        ? (f['Microsoft.VSTS.Common.Priority'] as number)
        : null,
    severity: (f['Microsoft.VSTS.Common.Severity'] as string) ?? null,
    effort:
      typeof f['Microsoft.VSTS.Scheduling.Effort'] === 'number'
        ? (f['Microsoft.VSTS.Scheduling.Effort'] as number)
        : null,
    story_points:
      typeof f['Microsoft.VSTS.Scheduling.StoryPoints'] === 'number'
        ? (f['Microsoft.VSTS.Scheduling.StoryPoints'] as number)
        : null,
    created_by: createdBy?.displayName ?? null,
    created_date: (f['System.CreatedDate'] as string) ?? null,
    attachments,
    relations,
  };
}

/* ---------------------------- comments ---------------------------- */

interface CommentsResp {
  totalCount: number;
  count: number;
  comments?: Array<{
    id: number;
    text: string;
    createdBy?: { displayName?: string };
    createdDate?: string;
    modifiedDate?: string;
  }>;
}

export async function listComments(
  orgUrl: string,
  project: string,
  id: number,
  pat: string,
): Promise<WorkItemComment[]> {
  // The comments endpoint is on the preview channel even in 7.1.
  const url = `${joinOrgProject(orgUrl, project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.3&$top=200&order=asc`;
  try {
    const body = await fetchJson<CommentsResp>(url, pat);
    return (body.comments ?? []).map((c) => ({
      id: c.id,
      text_html: c.text ?? '',
      created_by: c.createdBy?.displayName ?? '',
      created_date: c.createdDate ?? '',
      ...(c.modifiedDate ? { modified_date: c.modifiedDate } : {}),
    }));
  } catch {
    // Comments preview API can 404 on old collections — degrade quietly.
    return [];
  }
}

/* ---------------------------- attachment proxy ---------------------------- */

/** Stream an attachment through the daemon so the browser can render it
 *  without leaking the PAT into <img src=...>. */
export async function fetchAttachment(
  url: string,
  pat: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; status: number }> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader(pat), Accept: '*/*' },
    signal: AbortSignal.timeout(30_000),
  });
  return {
    body: res.body!,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    status: res.status,
  };
}

/* ---------------------------- states (per type) ---------------------------- */

interface StatesResp {
  count: number;
  value: Array<{ name: string; category?: string }>;
}

export async function listStatesForType(
  orgUrl: string,
  project: string,
  type: string,
  pat: string,
): Promise<string[]> {
  const url = `${joinOrgProject(orgUrl, project)}/_apis/wit/workitemtypes/${encodeURIComponent(
    type,
  )}/states?api-version=${API_VERSION}`;
  try {
    const body = await fetchJson<StatesResp>(url, pat);
    return (body.value ?? []).map((s) => s.name);
  } catch {
    return [];
  }
}
