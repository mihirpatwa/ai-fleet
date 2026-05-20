// Phase 18g: client-side mirror of daemon/src/azure/types.ts + a minimal HTML
// sanitizer used by WorkItemDrawer to render Azure description / acceptance
// criteria / repro steps. We don't pull in DOMPurify yet to keep deps lean;
// the daemon authenticates against Azure so the HTML source is trusted, but
// we still strip script/iframe/style + on* event handler attributes.

export interface AzureConnectionState {
  org_url: string;
  project: string;
  validated_at: string | null;
  connected: boolean;
  error: string | null;
}

export type WorkItemType = string;

export interface WorkItemSummary {
  id: number;
  type: WorkItemType;
  title: string;
  state: string;
  assigned_to: string | null;
  iteration_path: string | null;
  changed_date: string;
  url: string;
}

export interface WorkItemAttachment {
  name: string;
  url: string;
  size?: number;
}

export interface WorkItemRelation {
  rel: string;
  target_id?: number;
  url: string;
}

export interface WorkItemDetail extends WorkItemSummary {
  description_html: string | null;
  acceptance_criteria_html: string | null;
  repro_steps_html: string | null;
  system_history_html: string | null;
  tags: string[];
  area_path: string | null;
  priority: number | null;
  severity: string | null;
  effort: number | null;
  story_points: number | null;
  created_by: string | null;
  created_date: string | null;
  attachments: WorkItemAttachment[];
  relations: WorkItemRelation[];
}

export interface WorkItemComment {
  id: number;
  text_html: string;
  created_by: string;
  created_date: string;
  modified_date?: string;
}

/** Strip dangerous tags + on*-handler attributes. Optionally rewrite img/href
 *  pointing at the connected Azure org so the daemon's PAT-authed proxy
 *  serves them (otherwise the browser sees 401s on rendered content). */
export function sanitizeHtml(html: string | null, orgUrl?: string): string {
  if (!html) return '';
  let out = html
    .replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
  if (orgUrl) {
    const org = orgUrl.replace(/\/+$/, '');
    const escapedOrg = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Rewrite src/href that point at this Azure org through the proxy so
    // images/videos render with authentication.
    const re = new RegExp(`(src|href)\\s*=\\s*"(${escapedOrg}/[^"]+)"`, 'gi');
    out = out.replace(re, (_m, attr: string, url: string) => {
      const proxied = `/api/azure/attachment?url=${encodeURIComponent(url)}`;
      return `${attr}="${proxied}"`;
    });
  }
  return out;
}

/** Group raw relations into UX-friendly buckets so the drawer can render
 *  parent/child links separately from VCS artifact links. */
export interface GroupedRelations {
  workItems: WorkItemRelation[];
  pullRequests: WorkItemRelation[];
  commits: WorkItemRelation[];
  branches: WorkItemRelation[];
  other: WorkItemRelation[];
}

export function groupRelations(relations: WorkItemRelation[]): GroupedRelations {
  const out: GroupedRelations = {
    workItems: [],
    pullRequests: [],
    commits: [],
    branches: [],
    other: [],
  };
  for (const r of relations) {
    if (r.rel.startsWith('System.LinkTypes.')) out.workItems.push(r);
    else if (/PullRequestId/.test(r.url)) out.pullRequests.push(r);
    else if (/\/Git\/Commit\//i.test(r.url)) out.commits.push(r);
    else if (/\/Git\/Ref\//i.test(r.url) || /Branch/i.test(r.url)) out.branches.push(r);
    else out.other.push(r);
  }
  return out;
}

/** Pretty-print URL-encoded VCS refs Azure dumps into ArtifactLink URLs. */
export function decodeArtifactLabel(url: string): string {
  try {
    const decoded = decodeURIComponent(url);
    const commit = /\/Git\/Commit\/[0-9a-f-]+%2[fF]([0-9a-f]{6,40})/i.exec(url);
    if (commit) return `Commit ${commit[1]!.slice(0, 8)}`;
    const pr = /PullRequestId\/[0-9a-f-]+%2[fF][0-9a-f-]+%2[fF](\d+)/i.exec(url);
    if (pr) return `PR #${pr[1]}`;
    const branch = /\/Git\/Ref\/[^/]+\/(.+)$/i.exec(decoded);
    if (branch) return `Branch ${branch[1]}`;
    return decoded.slice(decoded.lastIndexOf('/') + 1);
  } catch {
    return url;
  }
}

/** Build a structured goal prompt from a work item — used by "Send as goal". */
export function workItemToGoal(item: WorkItemDetail): string {
  const lines: string[] = [];
  lines.push(`${item.type} #${item.id}: ${item.title}`);
  lines.push('');
  if (item.description_html) {
    lines.push('## Description');
    lines.push(stripHtml(item.description_html));
    lines.push('');
  }
  if (item.acceptance_criteria_html) {
    lines.push('## Acceptance criteria');
    lines.push(stripHtml(item.acceptance_criteria_html));
    lines.push('');
  }
  if (item.repro_steps_html) {
    lines.push('## Repro steps');
    lines.push(stripHtml(item.repro_steps_html));
    lines.push('');
  }
  if (item.attachments.length > 0) {
    lines.push('## Attachments');
    for (const a of item.attachments) lines.push(`- ${a.name}: ${a.url}`);
    lines.push('');
  }
  if (item.tags.length > 0) lines.push(`Tags: ${item.tags.join(', ')}`);
  lines.push(`Azure link: ${item.url}`);
  return lines.join('\n');
}

function stripHtml(html: string): string {
  return sanitizeHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
