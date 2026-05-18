// Secret scrubbing for anything that lands in the events table or logs.
// Tool inputs/outputs and assistant text pass through here before they are
// persisted, so a leaked key in a model transcript never reaches disk.

interface Rule {
  re: RegExp;
  marker: string;
}

// Order matters: the PEM block is matched first because it can legitimately
// contain substrings that look like the narrower token patterns. All regexes
// are global so every occurrence in a string is replaced.
const RULES: readonly Rule[] = [
  {
    re: /-----BEGIN[\s\S]+?PRIVATE KEY-----[\s\S]+?-----END[\s\S]+?KEY-----/g,
    marker: '[REDACTED:private_key]',
  },
  { re: /sk-[A-Za-z0-9]{32,}/g, marker: '[REDACTED:llm_key]' },
  { re: /ghp_[A-Za-z0-9]{36}/g, marker: '[REDACTED:github]' },
  { re: /AKIA[0-9A-Z]{16}/g, marker: '[REDACTED:aws]' },
  { re: /AIza[0-9A-Za-z\-_]{35}/g, marker: '[REDACTED:google]' },
  { re: /xox[baprs]-[0-9A-Za-z-]+/g, marker: '[REDACTED:slack]' },
];

/** Scrub every known secret pattern out of a single string. */
export function redactString(input: string): string {
  let out = input;
  for (const { re, marker } of RULES) {
    // Fresh lastIndex each pass; `re` is module-global so reset defensively.
    re.lastIndex = 0;
    out = out.replace(re, marker);
  }
  return out;
}

/**
 * Recursively redact secrets from an arbitrary value. Strings are scrubbed;
 * plain objects and arrays are deep-copied with their leaves scrubbed; every
 * other primitive is returned unchanged. Cyclic references are replaced with
 * the string `"[Circular]"` so this is always safe to call before JSON.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen));
  }

  // Only walk plain/dictionary-like objects. Exotic instances (Date, Buffer,
  // Map, …) are left intact — they don't carry free-text secrets and
  // stringifying them here would corrupt the payload.
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = redact(v, seen);
  }
  return out;
}
