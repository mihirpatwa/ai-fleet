#!/usr/bin/env -S node --import tsx
// Idempotent installer for the Claude Code hooks that stream every tool call
// of every spawned agent into the daemon's /events endpoint.
//
// It MERGES into ~/.claude/settings.json: unrelated settings and any
// non-ai-fleet hooks are preserved untouched. Our entries are tagged with a
// sentinel so re-running replaces them in place instead of stacking up.
//
// Override the target file with CLAUDE_SETTINGS_PATH and the port with
// AIFLEET_PORT (defaults: ~/.claude/settings.json, 7878).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sentinel embedded in every command we own, used to find+replace on re-run. */
export const HOOK_MARKER = 'aifleet:event-hook';

type HookCommand = { type: 'command'; command: string };
type HookMatcher = { matcher?: string; hooks: HookCommand[] };
type Settings = {
  hooks?: Record<string, HookMatcher[]>;
  [k: string]: unknown;
};

export function settingsPath(): string {
  return process.env['CLAUDE_SETTINGS_PATH'] ?? join(homedir(), '.claude', 'settings.json');
}

// A tool call → one POST to /events. Node (always present for Claude Code) is
// used instead of jq/curl so there is no extra dependency and JSON escaping is
// correct. The request is fire-and-forget with a hard 2s cap so a slow or
// down daemon never stalls the agent.
function hookCommand(port: number, eventType: string): string {
  const script =
    `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{` +
    `let j={};try{j=JSON.parse(s)}catch(e){}` +
    `let b=JSON.stringify({session_id:j.session_id,task_id:process.env.AIFLEET_TASK_ID,` +
    `event_type:"${eventType}",tool_name:j.tool_name,tool_input:j.tool_input,tool_output:j.tool_response});` +
    `fetch("http://localhost:${port}/events",{method:"POST",` +
    `headers:{"content-type":"application/json"},body:b,signal:AbortSignal.timeout(2000)})` +
    `.catch(()=>{})});/*${HOOK_MARKER}*/`;
  return `node -e '${script}'`;
}

export function isAifleetMatcher(m: HookMatcher): boolean {
  return m.hooks.some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER));
}

/**
 * Pure merge: returns a new settings object with ai-fleet hooks installed for
 * PreToolUse / PostToolUse / Stop, every other key and hook left as-is.
 */
export function mergeSettings(existing: Settings, port: number): Settings {
  const wanted: Record<string, string> = {
    PreToolUse: 'tool_use_pre',
    PostToolUse: 'tool_use_post',
    Stop: 'completed',
  };
  const hooks: Record<string, HookMatcher[]> = { ...(existing.hooks ?? {}) };
  for (const [event, type] of Object.entries(wanted)) {
    const kept = (hooks[event] ?? []).filter((m) => !isAifleetMatcher(m));
    const entry: HookMatcher =
      event === 'Stop'
        ? { hooks: [{ type: 'command', command: hookCommand(port, type) }] }
        : { matcher: '*', hooks: [{ type: 'command', command: hookCommand(port, type) }] };
    hooks[event] = [...kept, entry];
  }
  return { ...existing, hooks };
}

function readSettings(path: string): Settings {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as Settings;
  } catch (err) {
    // Never clobber a file we can't understand.
    throw new Error(
      `refusing to modify ${path}: not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

export function installHooks(
  opts: { path?: string; port?: number; print?: boolean } = {},
): Settings {
  const path = opts.path ?? settingsPath();
  const port = opts.port ?? Number(process.env['AIFLEET_PORT'] ?? 7878);
  const merged = mergeSettings(readSettings(path), port);
  if (opts.print) {
    process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
    return merged;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n');
  console.log(
    `ai-fleet hooks installed → ${path} (PreToolUse, PostToolUse, Stop → :${port}/events)`,
  );
  return merged;
}

const argv1 = process.argv[1];
const invokedDirectly = argv1 !== undefined && resolve(argv1) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    installHooks({ print: process.argv.includes('--print') });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
