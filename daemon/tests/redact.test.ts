import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../src/redact.js';

describe('redact', () => {
  it('replaces every known secret shape', () => {
    expect(redactString(`key sk-${'a'.repeat(40)} end`)).toBe('key [REDACTED:llm_key] end');
    expect(redactString(`ghp_${'b'.repeat(36)}`)).toBe('[REDACTED:github]');
    expect(redactString('AKIA' + 'ABCDEFGHIJKLMNOP')).toBe('[REDACTED:aws]');
    expect(redactString('AIza' + 'C'.repeat(35))).toBe('[REDACTED:google]');
    expect(redactString('xoxb-12345-abcDEF-xyz')).toBe('[REDACTED:slack]');
  });

  it('redacts a multi-line PEM private key block', () => {
    const pem =
      'before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\nzzz\n-----END RSA PRIVATE KEY-----\nafter';
    expect(redact(pem)).toBe('before\n[REDACTED:private_key]\nafter');
  });

  it('recurses objects and arrays, leaving non-strings intact', () => {
    const out = redact({
      ok: 1,
      flag: true,
      nested: { token: `sk-${'z'.repeat(33)}`, list: [`ghp_${'g'.repeat(36)}`, 42, null] },
    }) as Record<string, unknown>;
    expect(out['ok']).toBe(1);
    expect(out['flag']).toBe(true);
    const nested = out['nested'] as Record<string, unknown>;
    expect(nested['token']).toBe('[REDACTED:llm_key]');
    expect((nested['list'] as unknown[])[0]).toBe('[REDACTED:github]');
    expect((nested['list'] as unknown[])[1]).toBe(42);
    expect((nested['list'] as unknown[])[2]).toBeNull();
  });

  it('does not mutate the input and is cycle-safe', () => {
    const input: Record<string, unknown> = { a: `sk-${'q'.repeat(40)}` };
    input['self'] = input;
    const out = redact(input) as Record<string, unknown>;
    expect(input['a']).toBe(`sk-${'q'.repeat(40)}`); // original untouched
    expect(out['a']).toBe('[REDACTED:llm_key]');
    expect(out['self']).toBe('[Circular]');
  });
});
