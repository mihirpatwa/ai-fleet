import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { parseAgentFile, parseAgentJson, resolveModel } from '../src/spawn.js';

const docWriterMd = fileURLToPath(new URL('../../agents/doc-writer.md', import.meta.url));

describe('parseAgentFile', () => {
  it('splits frontmatter from the prompt body of a real agent definition', () => {
    const a = parseAgentFile(readFileSync(docWriterMd, 'utf8'));
    expect(a.name).toBe('doc-writer');
    expect(a.model).toBe('claude-sonnet-4-6');
    expect(a.tools).toEqual(['Read', 'Write', 'Edit']);
    expect(a.description).toMatch(/documentation/i);
    expect(a.prompt).toContain('You are the **doc-writer** subagent');
  });

  it('rejects files without frontmatter or description', () => {
    expect(() => parseAgentFile('no frontmatter here')).toThrow(/frontmatter/);
    expect(() => parseAgentFile('---\nname: x\n---\nbody')).toThrow(/description/);
    expect(() => parseAgentFile('---\ndescription: d\n---\n   ')).toThrow(/empty prompt/);
  });
});

describe('resolveModel', () => {
  it('uses orchestrator_model for the orchestrator and default_model otherwise', () => {
    const c = parseConfig({});
    expect(resolveModel(c, 'orchestrator')).toBe('claude-opus-4-7');
    expect(resolveModel(c, 'coder')).toBe('claude-sonnet-4-6');
  });

  it('honors per_agent_models overrides first', () => {
    const c = parseConfig({ per_agent_models: { coder: 'claude-opus-4-7' } });
    expect(resolveModel(c, 'coder')).toBe('claude-opus-4-7');
    expect(resolveModel(c, 'orchestrator')).toBe('claude-opus-4-7');
  });
});

describe('parseAgentJson', () => {
  it('extracts a fenced ```json block', () => {
    const text = 'prose\n```json\n{"agent":"doc-writer","status":"ok"}\n```\ntrailing';
    expect(parseAgentJson(text)).toEqual({ agent: 'doc-writer', status: 'ok' });
  });

  it('parses a bare JSON payload', () => {
    expect(parseAgentJson('  {"a":1}  ')).toEqual({ a: 1 });
  });

  it('falls back to the outermost object slice', () => {
    expect(parseAgentJson('here you go: {"x":[1,2]} thanks')).toEqual({ x: [1, 2] });
  });

  it('returns undefined when there is no JSON', () => {
    expect(parseAgentJson('no json at all')).toBeUndefined();
  });
});
