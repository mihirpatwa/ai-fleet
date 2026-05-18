// Append-only audit trail of every mediated tool invocation. Deliberately
// separate from the events table (different store, append-only, never
// auto-deleted) for tamper resistance. Daily-rotated JSONL with a stable
// `audit.log` symlink, same approach as logger.ts.
import { closeSync, mkdirSync, openSync, symlinkSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { nowTs } from './time.js';

export interface AuditEntry {
  task_id: string;
  agent: string;
  tool: string;
  target: string;
  allowed: boolean;
  denied_reason?: string;
}

export interface AuditLog {
  record(e: AuditEntry): void;
  readonly path: string;
  close(): void;
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createAuditLog(dir: string): AuditLog {
  mkdirSync(dir, { recursive: true });
  const stablePath = join(dir, 'audit.log');
  let fd: number | null = null;
  let date = '';

  function rollover(): void {
    const today = utcDate();
    if (today === date && fd !== null) return;
    if (fd !== null) closeSync(fd);
    const name = `audit-${today}.log`;
    fd = openSync(join(dir, name), 'a'); // append-only, never truncated
    date = today;
    try {
      unlinkSync(stablePath);
    } catch {
      /* no existing link */
    }
    try {
      symlinkSync(name, stablePath);
    } catch {
      /* symlinks unsupported — dated file is authoritative */
    }
  }

  return {
    path: stablePath,
    record(e: AuditEntry): void {
      try {
        rollover();
        writeSync(fd as number, JSON.stringify({ ts: nowTs(), ...e }) + '\n');
      } catch {
        // Auditing must never crash a run; a failed write is itself a signal
        // but there's no safe place left to record it.
      }
    },
    close(): void {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
    },
  };
}
