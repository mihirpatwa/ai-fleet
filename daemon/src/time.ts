// One source of truth for timestamp formatting. SQLite's CURRENT_TIMESTAMP
// renders `YYYY-MM-DD HH:MM:SS` (UTC); every timestamp we write by hand must
// match so range comparisons against DB-defaulted columns stay correct.
export function nowTs(d: Date = new Date()): string {
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}
