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
  tags: string[];
  area_path: string | null;
  priority: number | null;
  severity: string | null;
  attachments: WorkItemAttachment[];
  relations: WorkItemRelation[];
}

export function sanitizeHtml(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
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
