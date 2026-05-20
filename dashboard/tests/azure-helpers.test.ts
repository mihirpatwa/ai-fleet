// t20: dashboard unit tests for lib/azure helpers. Runs under jsdom so
// DOMPurify (which sniffs `window`) can mount its real implementation.
import { describe, expect, it } from 'vitest';
import {
  decodeArtifactLabel,
  groupRelations,
  sanitizeHtml,
  workItemToGoal,
  type WorkItemDetail,
  type WorkItemRelation,
} from '@/lib/azure';

describe('sanitizeHtml', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeHtml('<p>safe</p><script>alert(1)</script>');
    expect(out).toContain('<p>safe</p>');
    expect(out).not.toContain('<script');
  });

  it('drops on* event handlers', () => {
    const out = sanitizeHtml('<a href="https://x" onclick="boom()">x</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('href="https://x"');
  });

  it('forces rel=noopener on target=_blank links (t12)', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });

  it('rewrites org-hosted src to the daemon proxy', () => {
    const html =
      '<img src="https://dev.azure.com/contoso/_apis/wit/attachments/abc.png">';
    const out = sanitizeHtml(html, 'https://dev.azure.com/contoso');
    expect(out).toContain('/api/azure/attachment?url=');
    expect(out).not.toContain('https://dev.azure.com/contoso/_apis/wit/attachments/abc.png"');
  });

  it('leaves non-org src untouched', () => {
    const html = '<img src="https://cdn.example.com/x.png">';
    const out = sanitizeHtml(html, 'https://dev.azure.com/contoso');
    expect(out).toContain('https://cdn.example.com/x.png');
  });

  it('returns empty for null/empty input', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('groupRelations', () => {
  const rels: WorkItemRelation[] = [
    { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev/_apis/wit/workItems/1' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/abc' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/123' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/Ref/branch/main' },
    { rel: 'ArtifactLink', url: 'vstfs:///OtherType/Foo' },
  ];

  it('routes each relation into the right bucket', () => {
    const g = groupRelations(rels);
    expect(g.workItems.length).toBe(1);
    expect(g.commits.length).toBe(1);
    expect(g.pullRequests.length).toBe(1);
    expect(g.branches.length).toBe(1);
    expect(g.other.length).toBe(1);
  });
});

describe('decodeArtifactLabel', () => {
  it('extracts short commit hash', () => {
    expect(decodeArtifactLabel('vstfs:///Git/Commit/abc%2fdef0123456789abcdef0123456789abcdef')).toMatch(
      /^Commit /,
    );
  });
  it('extracts PR id', () => {
    expect(decodeArtifactLabel('vstfs:///Git/PullRequestId/abc%2fdef%2f17889')).toBe(
      'PR #17889',
    );
  });
});

describe('workItemToGoal', () => {
  const base: WorkItemDetail = {
    id: 42,
    type: 'User Story',
    title: 'Demo',
    state: 'Active',
    assigned_to: 'Alice',
    iteration_path: null,
    changed_date: '2025-01-01',
    url: 'https://example/wi',
    description_html: '<p>Build the thing</p>',
    acceptance_criteria_html: '<ul><li>It works</li></ul>',
    repro_steps_html: null,
    system_history_html: null,
    tags: ['a', 'b'],
    area_path: null,
    priority: null,
    severity: null,
    effort: null,
    story_points: null,
    created_by: null,
    created_date: null,
    attachments: [
      { name: 'mock.png', url: 'https://example/mock.png', size: 1024 },
    ],
    relations: [],
  };

  it('stitches the structured prompt with description + AC + attachments + tags', () => {
    const prompt = workItemToGoal(base);
    expect(prompt).toContain('User Story #42: Demo');
    expect(prompt).toContain('## Description');
    expect(prompt).toContain('Build the thing');
    expect(prompt).toContain('## Acceptance criteria');
    expect(prompt).toContain('It works');
    expect(prompt).toContain('## Attachments');
    expect(prompt).toContain('mock.png');
    expect(prompt).toContain('Tags: a, b');
    expect(prompt).toContain('Azure link: https://example/wi');
  });
});
