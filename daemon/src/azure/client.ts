// Phase 18g: Azure DevOps REST client. Minimal — covers what the dashboard
// needs (connection probe, work-item list via WIQL, work-item detail with
// attachments/relations) without pulling in azure-devops-node-api (huge
// dep). PAT goes into Authorization: Basic <base64(":<PAT>")>; the daemon
// loads it from secrets.env (AZURE_DEVOPS_PAT) on boot.

import { Buffer } from 'node:buffer';
import type {
  ListFilter,
  WorkItemAttachment,
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

  return {
    ...summary,
    description_html: (f['System.Description'] as string) ?? null,
    acceptance_criteria_html:
      (f['Microsoft.VSTS.Common.AcceptanceCriteria'] as string) ?? null,
    repro_steps_html: (f['Microsoft.VSTS.TCM.ReproSteps'] as string) ?? null,
    tags,
    area_path: (f['System.AreaPath'] as string) ?? null,
    priority:
      typeof f['Microsoft.VSTS.Common.Priority'] === 'number'
        ? (f['Microsoft.VSTS.Common.Priority'] as number)
        : null,
    severity: (f['Microsoft.VSTS.Common.Severity'] as string) ?? null,
    attachments,
    relations,
  };
}
