// Phase 12: file-edit capture. The daemon learns about tool use through the
// hook ingestion endpoint (POST /events) — there is no separate hook process —
// so server.ts calls these on tool_use_pre / tool_use_post for the editing
// tools. PreToolUse snapshots the file as it is *before* the edit; PostToolUse
// reads it *after*, diffs against the snapshot, persists the pair, and emits
// file_edit_start / file_edit_done so the dashboard can show a live diff.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createPatch } from 'diff';
import type { FleetBus } from './bus.js';
import type { FleetDb } from './db.js';
import { recordAndBroadcast } from './events.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

// Guard the DB against a pathological multi-MB file blowing up state.db.
const MAX_CONTENT = 1_000_000;

export interface FileEditCtx {
  taskId: string;
  agent: string | null;
  projectRoot: string;
  toolName: string;
  toolInput: unknown;
}

function filePathOf(input: unknown): string | null {
  if (input && typeof input === 'object' && 'file_path' in input) {
    const fp = (input as { file_path?: unknown }).file_path;
    if (typeof fp === 'string' && fp.length > 0) return fp;
  }
  return null;
}

function resolveAbs(projectRoot: string, fp: string): string {
  return isAbsolute(fp) ? fp : join(projectRoot, fp);
}

function readIfExists(abs: string): string {
  try {
    if (!existsSync(abs)) return '';
    const c = readFileSync(abs, 'utf8');
    return c.length > MAX_CONTENT ? c.slice(0, MAX_CONTENT) + '\n…[truncated]…' : c;
  } catch {
    return '';
  }
}

function summarize(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (toolName === 'Write') {
    const n = typeof i['content'] === 'string' ? (i['content'] as string).length : 0;
    return `write (${n} bytes)`;
  }
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(i['edits']) ? (i['edits'] as unknown[]).length : 0;
    return `multiedit (${edits} edit${edits === 1 ? '' : 's'})`;
  }
  // Edit
  const o = typeof i['old_string'] === 'string' ? (i['old_string'] as string) : '';
  const nw = typeof i['new_string'] === 'string' ? (i['new_string'] as string) : '';
  const clip = (s: string): string => (s.length > 60 ? s.slice(0, 59) + '…' : s).replace(/\n/g, '⏎');
  return `edit: "${clip(o)}" → "${clip(nw)}"`;
}

/** PreToolUse: snapshot current content + announce the edit starting. */
export function onToolUsePre(db: FleetDb, bus: FleetBus, ctx: FileEditCtx): void {
  if (!EDIT_TOOLS.has(ctx.toolName)) return;
  const fp = filePathOf(ctx.toolInput);
  if (!fp) return;
  const before = readIfExists(resolveAbs(ctx.projectRoot, fp));
  db.raw
    .prepare(
      `INSERT INTO file_snapshots (task_id, agent, file_path, before_content, intended_change)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ctx.taskId, ctx.agent, fp, before, summarize(ctx.toolName, ctx.toolInput));
  recordAndBroadcast(db, bus, {
    taskId: ctx.taskId,
    ...(ctx.agent ? { agent: ctx.agent } : {}),
    type: 'file_edit_start',
    payloadJson: { file_path: fp, before_size: before.length },
  });
}

/** PostToolUse: diff against the snapshot, persist, announce completion. */
export function onToolUsePost(db: FleetDb, bus: FleetBus, ctx: FileEditCtx): void {
  if (!EDIT_TOOLS.has(ctx.toolName)) return;
  const fp = filePathOf(ctx.toolInput);
  if (!fp) return;
  const after = readIfExists(resolveAbs(ctx.projectRoot, fp));
  const snap = db.raw
    .prepare(
      `SELECT before_content AS before
         FROM file_snapshots
        WHERE task_id = ? AND file_path = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(ctx.taskId, fp) as { before?: string } | undefined;
  const before = snap?.before ?? '';
  if (before === after) return; // no-op edit; nothing to show

  const diffUnified = createPatch(fp, before, after, '', '');
  let added = 0;
  let removed = 0;
  for (const line of diffUnified.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  const info = db.raw
    .prepare(
      `INSERT INTO file_edits
         (task_id, agent, file_path, before_content, after_content, diff_unified, lines_added, lines_removed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ctx.taskId, ctx.agent, fp, before, after, diffUnified, added, removed);
  recordAndBroadcast(db, bus, {
    taskId: ctx.taskId,
    ...(ctx.agent ? { agent: ctx.agent } : {}),
    type: 'file_edit_done',
    payloadJson: {
      file_path: fp,
      file_edit_id: Number(info.lastInsertRowid),
      lines_added: added,
      lines_removed: removed,
    },
  });
}
