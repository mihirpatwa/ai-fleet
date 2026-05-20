// v11: unit tests for the workItemHelpers pure functions.
import { describe, expect, it } from 'vitest';
import {
  buildQuery,
  clampPageSize,
  friendlyAzureError,
  readFiltersFromSp,
  writeFiltersToSp,
} from '@/lib/workItemHelpers';

describe('clampPageSize', () => {
  it('falls back to 25 for invalid input', () => {
    expect(clampPageSize(NaN)).toBe(25);
    expect(clampPageSize(0)).toBe(25);
    expect(clampPageSize(-10)).toBe(25);
  });
  it('caps at 200', () => {
    expect(clampPageSize(500)).toBe(200);
  });
  it('passes through normal values', () => {
    expect(clampPageSize(50)).toBe(50);
    expect(clampPageSize(200)).toBe(200);
  });
});

describe('readFiltersFromSp', () => {
  it('returns an empty object when no params are set', () => {
    const sp = new URLSearchParams();
    expect(readFiltersFromSp(sp)).toEqual({});
  });
  it('splits CSV multi-values + drops empties', () => {
    const sp = new URLSearchParams('type=Bug,Feature&state=,Active,,');
    expect(readFiltersFromSp(sp)).toEqual({
      type: ['Bug', 'Feature'],
      state: ['Active'],
    });
  });
  it('reads scalar fields', () => {
    const sp = new URLSearchParams('assigned_to=Alice&search=hello&tag=urgent');
    expect(readFiltersFromSp(sp)).toEqual({
      assigned_to: 'Alice',
      search: 'hello',
      tag: 'urgent',
    });
  });
});

describe('writeFiltersToSp', () => {
  it('clears keys when value is empty', () => {
    const sp = new URLSearchParams('type=Bug&search=old');
    writeFiltersToSp(sp, { search: 'new' });
    expect(sp.get('type')).toBeNull();
    expect(sp.get('search')).toBe('new');
  });
  it('joins arrays with commas', () => {
    const sp = new URLSearchParams();
    writeFiltersToSp(sp, { type: ['Bug', 'Task'] });
    expect(sp.get('type')).toBe('Bug,Task');
  });
});

describe('buildQuery', () => {
  it('always emits page + pageSize', () => {
    const q = buildQuery({}, 2, 50);
    const sp = new URLSearchParams(q);
    expect(sp.get('page')).toBe('2');
    expect(sp.get('pageSize')).toBe('50');
  });
  it('encodes filters', () => {
    const q = buildQuery({ search: 'foo bar', type: ['Bug'] }, 1, 25);
    const sp = new URLSearchParams(q);
    expect(sp.get('search')).toBe('foo bar');
    expect(sp.get('type')).toBe('Bug');
  });
});

describe('friendlyAzureError', () => {
  it('rewrites 401 / 403 / 404', () => {
    expect(friendlyAzureError('Azure 401: bad token')).toMatch(/expired/);
    expect(friendlyAzureError('Azure 403: forbidden')).toMatch(/scope|workflow/);
    expect(friendlyAzureError('Azure 404: not found')).toMatch(/deleted/);
  });
  it('rewrites "cannot be changed" transitions', () => {
    expect(friendlyAzureError('State cannot be changed from foo')).toMatch(
      /workflow/,
    );
  });
  it('passes unknown errors through untouched', () => {
    expect(friendlyAzureError('something else')).toBe('something else');
  });
});
