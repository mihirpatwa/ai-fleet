// v2: tests for the in-process attachment cache counters.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentCacheStats,
  clearAttachmentCache,
  fetchAttachment,
} from '../src/azure/client.js';

beforeEach(() => {
  clearAttachmentCache();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function fakeOk(body: Uint8Array, type = 'image/png'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': type },
  });
}

describe('attachmentCache counters', () => {
  it('starts at zero after clear', () => {
    const s = attachmentCacheStats();
    expect(s).toMatchObject({ entries: 0, bytes: 0, hits: 0, misses: 0 });
    expect(s.oldestAgeMs).toBeNull();
  });

  it('bumps miss on first fetch and hit on the second', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeOk(payload)),
    );
    const url = 'https://dev.azure.com/contoso/_apis/wit/attachments/abc';
    await fetchAttachment(url, 'pat');
    await fetchAttachment(url, 'pat');
    const s = attachmentCacheStats();
    expect(s.entries).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.hits).toBe(1);
    expect(s.bytes).toBe(payload.length);
    expect(s.oldestAgeMs).not.toBeNull();
  });

  it('clear resets counters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeOk(new Uint8Array([9, 9, 9]))),
    );
    await fetchAttachment('https://dev.azure.com/contoso/x', 'pat');
    clearAttachmentCache();
    const s = attachmentCacheStats();
    expect(s).toMatchObject({ entries: 0, bytes: 0, hits: 0, misses: 0 });
  });
});
