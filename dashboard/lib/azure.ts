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

// q12: prefer isomorphic-dompurify (real HTML parser + allowlist) over a
// regex strip. The regex version stayed in the codebase as a fallback for
// any environment where dompurify can't be loaded (e.g. the unit test SSR
// path before jsdom mounts).
//
// t12: every <a target="_blank"> gets rel="noopener noreferrer" forced via
// an afterSanitizeAttributes hook, so an attacker-controlled link in an
// Azure description can't tamper with window.opener.
import DOMPurify from 'isomorphic-dompurify';

let hookInstalled = false;
function ensureHook(): void {
  if (hookInstalled) return;
  try {
    DOMPurify.addHook('afterSanitizeAttributes', (node: unknown) => {
      // u13: cross-realm safe — `instanceof Element` fails when DOMPurify
      // and the host bundle were loaded against different realms (e.g.
      // jsdom under vitest). nodeType + duck typing is reliable.
      const n = node as {
        nodeType?: number;
        tagName?: string;
        getAttribute?: (k: string) => string | null;
        setAttribute?: (k: string, v: string) => void;
      };
      if (n.nodeType !== 1) return;
      if (n.tagName === 'A' && n.getAttribute?.('target') === '_blank') {
        n.setAttribute?.('rel', 'noopener noreferrer');
      }
    });
    hookInstalled = true;
  } catch {
    /* ignore — fallback path will handle it */
  }
}

const FALLBACK_RE = {
  killTags: /<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi,
  killHandlers: /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
  killJs: /javascript:/gi,
};

function regexFallback(html: string): string {
  return html
    .replace(FALLBACK_RE.killTags, '')
    .replace(FALLBACK_RE.killHandlers, '')
    .replace(FALLBACK_RE.killJs, '');
}

/** Run HTML through DOMPurify; rewrite `src`/`href` that point at the
 *  connected Azure org through the PAT-authed daemon proxy so inline
 *  images and links render without leaking the token. */
export function sanitizeHtml(html: string | null, orgUrl?: string): string {
  if (!html) return '';
  ensureHook();
  let cleaned: string;
  try {
    cleaned = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_ATTR: [
        'href',
        'src',
        'alt',
        'title',
        'class',
        'style',
        'width',
        'height',
        'target',
        'rel',
        'colspan',
        'rowspan',
        'align',
        'name',
        'id',
      ],
      ADD_ATTR: ['target', 'rel'],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'meta', 'link'],
    });
  } catch {
    // dompurify can throw in odd SSR setups; the regex strip is a last resort.
    cleaned = regexFallback(html);
  }
  if (!orgUrl) return cleaned;
  const org = orgUrl.replace(/\/+$/, '');
  const escapedOrg = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(src|href)\\s*=\\s*"(${escapedOrg}/[^"]+)"`, 'gi');
  return cleaned.replace(re, (_m, attr: string, url: string) => {
    const proxied = `/api/azure/attachment?url=${encodeURIComponent(url)}`;
    return `${attr}="${proxied}"`;
  });
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
