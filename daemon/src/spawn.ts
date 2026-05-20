// The agent host. Each ready task is run through the Claude Agent SDK as the
// task's assigned subagent: its markdown definition becomes the main-thread
// agent, the SDK stream is mirrored into the events table, token usage is
// priced into agent_runs, and the final fenced-JSON message is parsed into
// the task's output_json. Failures retry with the configured backoff.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  query,
  type AgentDefinition,
  type Options,
  type PermissionResult,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import yaml from 'js-yaml';
import type { Logger } from 'pino';
import type { AuditLog } from './audit.js';
import type { FleetBus, SessionTaskMap } from './bus.js';
import type { FleetConfig } from './config.js';
import type { FleetDb, Json, Task } from './db.js';
import { recordAndBroadcast } from './events.js';
import { createMemoryMcp } from './mcp/memory.js';
import { completedRetrospectorRuns, regenerateHotTier } from './memory.js';
import {
  INJECTION_SUFFIX,
  buildPrompt,
  decideTool,
  readProjectPolicy,
  workDir,
  type SandboxContext,
} from './sandbox.js';
import { unresolvedSecurityBlock } from './security.js';
import type { Alerts } from './alerts.js';
import { nowTs } from './time.js';

/** `~/.claude/agents` by default; `AIFLEET_AGENTS_DIR` redirects it (tests, smoke). */
export function getAgentsDir(): string {
  return process.env['AIFLEET_AGENTS_DIR'] ?? join(homedir(), '.claude', 'agents');
}

export function agentPath(agent: string): string {
  return join(getAgentsDir(), `${agent}.md`);
}

export interface ParsedAgent {
  name?: string;
  description: string;
  model?: string;
  tools?: string[];
  prompt: string;
}

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

/** Split a subagent markdown file into its YAML frontmatter and prompt body. */
export function parseAgentFile(text: string): ParsedAgent {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) throw new Error('agent file missing YAML frontmatter');
  const [, fmText = '', bodyText = ''] = m;
  const fm = yaml.load(fmText) as Record<string, unknown> | null;
  if (!fm || typeof fm !== 'object') throw new Error('agent frontmatter is not a mapping');
  const description = fm['description'];
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error('agent frontmatter missing "description"');
  }
  const prompt = bodyText.trim();
  if (!prompt) throw new Error('agent file has an empty prompt body');
  const toolsRaw = fm['tools'];
  const tools = Array.isArray(toolsRaw) ? toolsRaw.map(String) : undefined;
  const model = typeof fm['model'] === 'string' ? fm['model'] : undefined;
  const name = typeof fm['name'] === 'string' ? fm['name'] : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    description,
    ...(model !== undefined ? { model } : {}),
    ...(tools !== undefined ? { tools } : {}),
    prompt,
  };
}

/**
 * Resolve the model for an agent. Precedence: per-task override → per-agent
 * selection → orchestrator/default — all from config.model_selection (phase
 * 13). The override is only honoured when per_task_allow_override is set.
 */
export function resolveModel(
  config: FleetConfig,
  agent: string,
  override?: string | null,
): string {
  if (override) return override;
  const ms = config.model_selection;
  return ms.per_agent[agent] ?? (agent === 'orchestrator' ? ms.orchestrator : ms.default);
}

/** Per-task model override carried in a task's input_json, if present. */
function readModelOverride(input: unknown): string | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const v = (input as Record<string, unknown>)['model_override'];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Heuristic: did the SDK fail because the model id is gone/deprecated? */
export function isModelDeprecated(message: string): boolean {
  const m = message.toLowerCase();
  if (!/model/.test(m)) return false;
  return (
    /\b404\b/.test(m) ||
    /not[_ ]?found/.test(m) ||
    /deprecat/.test(m) ||
    /no such model|unknown model|invalid model|model.*(removed|retired)/.test(m)
  );
}

/**
 * Best-effort extraction of the agent's machine-readable result. Subagents are
 * instructed to end with exactly one fenced ```json block; fall back to a bare
 * fenced block, a whole-text parse, then the outermost {...}/[...] slice.
 */
export function parseAgentJson(text: string): Json | undefined {
  const tryParse = (s: string): Json | undefined => {
    try {
      return JSON.parse(s) as Json;
    } catch {
      return undefined;
    }
  };
  const fences = [...text.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)```/gi)];
  for (let i = fences.length - 1; i >= 0; i--) {
    const body = fences[i]?.[1];
    if (body) {
      const parsed = tryParse(body.trim());
      if (parsed !== undefined) return parsed;
    }
  }
  const whole = tryParse(text.trim());
  if (whole !== undefined) return whole;
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start !== -1 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export interface SpawnerDeps {
  db: FleetDb;
  config: FleetConfig;
  bus: FleetBus;
  sessionMap: SessionTaskMap;
  logger: Logger;
  audit: AuditLog;
  alerts: Alerts;
}

export interface Spawner {
  /** Run one task to a terminal state (or schedule its retry). Never rejects. */
  spawnAgent(task: Task): Promise<void>;
  /** Count of currently-streaming SDK queries. */
  inFlight(): number;
  /** Interrupt every live query and cancel pending retry timers (shutdown). */
  shutdown(): Promise<void>;
}

export function createSpawner(deps: SpawnerDeps): Spawner {
  const { db, config, bus, sessionMap, logger, audit, alerts } = deps;
  const live = new Map<string, Query>();
  const retryTimers = new Map<string, NodeJS.Timeout>();

  function emit(
    task: Task,
    type: 'started' | 'log' | 'tool_use_pre' | 'completed' | 'failed' | 'blocked',
    payload: Json,
  ): void {
    recordAndBroadcast(db, bus, {
      taskId: task.id,
      agent: task.assignedAgent,
      type,
      payloadJson: payload,
    });
  }

  function onFailure(task: Task, message: string): void {
    const fresh = db.getTask(task.id) ?? task;
    const attempt = fresh.retryCount;
    const max = config.retry_policy.max_retries;
    if (attempt < max) {
      const nextCount = attempt + 1;
      const backoff = config.retry_policy.backoff_ms[
        Math.min(nextCount - 1, config.retry_policy.backoff_ms.length - 1)
      ] as number;
      db.updateTask(task.id, { retryCount: nextCount, error: message });
      logger.warn(
        { taskId: task.id, attempt: nextCount, max, backoffMs: backoff },
        'agent run failed; scheduling retry',
      );
      emit(task, 'log', { retry: nextCount, of: max, backoffMs: backoff, error: message });
      // The task stays `running` for the backoff window — getReadyTasks only
      // returns `queued`, so it won't be re-picked early. loop.ts requeues
      // orphaned `running` rows on startup, covering a mid-backoff crash.
      const timer = setTimeout(() => {
        retryTimers.delete(task.id);
        try {
          db.updateTask(task.id, { status: 'queued' });
        } catch (err) {
          logger.error({ taskId: task.id, err }, 'failed to requeue task for retry');
        }
      }, backoff);
      timer.unref();
      retryTimers.set(task.id, timer);
    } else {
      db.updateTask(task.id, { status: 'failed', error: message });
      logger.error({ taskId: task.id, attempt, max }, 'agent run failed; retries exhausted');
      emit(task, 'failed', { error: message, retries: attempt });
      if (task.parentId === null) {
        void alerts.notify('goal_failed', {
          taskId: task.id,
          projectRoot: task.projectRoot,
          summary: message,
        });
      }
      queueRetrospector(task);
    }
  }

  /**
   * When a ROOT task reaches a terminal state, queue a one-shot retrospector
   * child (the orchestrator is also prompted to, but the daemon guarantees it
   * for direct submissions too). The retrospector only has Read + memory.add,
   * so the tree's log + outputs are passed to it via input_json.
   */
  function queueRetrospector(task: Task): void {
    if (task.parentId !== null || task.assignedAgent === 'retrospector') return;
    const tree = db.getTaskTree(task.rootId);
    if (tree.some((t) => t.assignedAgent === 'retrospector')) return; // once per tree
    const tasksSummary = tree.map((t) => ({
      id: t.id,
      agent: t.assignedAgent,
      status: t.status,
      title: t.title,
      output: t.outputJson ?? null,
    }));
    const events: Json[] = [];
    for (const t of tree) {
      for (const e of db.listEvents({ taskId: t.id, order: 'asc', limit: 60 })) {
        events.push({
          task: e.taskId,
          agent: e.agent,
          type: e.type,
          ts: e.ts,
          payload: e.payloadJson,
        });
      }
    }
    db.createTask({
      projectRoot: task.projectRoot,
      parentId: task.id,
      title: `retrospect: ${task.title.slice(0, 80)}`,
      assignedAgent: 'retrospector',
      inputJson: {
        project_root: task.projectRoot,
        root_id: task.rootId,
        goal: task.title,
        final_status: db.getTask(task.id)?.status ?? task.status,
        tasks: tasksSummary as Json,
        events: events.slice(-300),
      },
    });
    logger.info({ taskId: task.id, rootId: task.rootId }, 'queued retrospector for terminal root');
  }

  async function spawnAgent(task: Task): Promise<void> {
    const file = agentPath(task.assignedAgent);
    if (!existsSync(file)) {
      onFailure(task, `agent definition not found: ${file}`);
      return;
    }

    let parsed: ParsedAgent;
    try {
      parsed = parseAgentFile(readFileSync(file, 'utf8'));
    } catch (err) {
      onFailure(task, `cannot parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Per-task override: prefer this task's, else the root task's (so the
    // whole tree honours a goal-level model choice), gated by config.
    const ownOverride = readModelOverride(task.inputJson);
    const rootOverride =
      task.parentId === null
        ? ownOverride
        : (ownOverride ?? readModelOverride(db.getTask(task.rootId)?.inputJson));
    const override = config.model_selection.per_task_allow_override ? rootOverride : null;
    const model = resolveModel(config, task.assignedAgent, override);
    const wdir = workDir(task.id);
    try {
      mkdirSync(wdir, { recursive: true });
    } catch {
      /* best effort */
    }
    const inputObj: Record<string, unknown> =
      task.inputJson && typeof task.inputJson === 'object' && !Array.isArray(task.inputJson)
        ? (task.inputJson as Record<string, unknown>)
        : {};
    const ctx: SandboxContext = {
      taskId: task.id,
      agent: task.assignedAgent,
      projectRoot: task.projectRoot,
      workDir: wdir,
      allowEnvRead: inputObj['allow_env_read'] === true,
      allowNetwork: task.assignedAgent === 'researcher' || inputObj['allow_network'] === true,
    };

    db.updateTask(task.id, { status: 'running' }); // auto-stamps started_at
    const started = db.getTask(task.id);
    const startedAt = started?.startedAt ?? nowTs();
    emit(task, 'started', { agent: task.assignedAgent, model });
    logger.info({ taskId: task.id, agent: task.assignedAgent, model }, 'spawning agent');

    // Adaptive memory: shadow window is per-project (first N retrospect runs).
    const priorRetro = completedRetrospectorRuns(db, task.projectRoot);
    const shadowRemaining = Math.max(0, config.memory.shadow_runs - priorRetro);
    const MEM_TOOLS = [
      'mcp__memory__search',
      'mcp__memory__add',
      'mcp__memory__list',
      'mcp__memory__pin',
    ];

    const def: AgentDefinition = {
      description: parsed.description,
      // Prompt-injection mitigation: every spawned agent carries the suffix.
      prompt: parsed.prompt + INJECTION_SUFFIX,
      model,
      // When the agent restricts tools, the memory MCP tools must be allowed
      // too or the SDK hides them.
      ...(parsed.tools ? { tools: [...new Set([...parsed.tools, ...MEM_TOOLS])] } : {}),
    };

    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<PermissionResult> => {
      const d = decideTool(ctx, toolName, input);
      audit.record({
        task_id: task.id,
        agent: task.assignedAgent,
        tool: toolName,
        target: d.target,
        allowed: d.allowed,
        ...(d.reason ? { denied_reason: d.reason } : {}),
      });
      if (d.allowed) return { behavior: 'allow', updatedInput: input };
      emit(task, 'log', { sandbox_denied: toolName, reason: d.reason ?? null, target: d.target });
      return { behavior: 'deny', message: `sandbox: ${d.reason}` };
    };

    const options: Options = {
      cwd: task.projectRoot,
      // Run the main thread AS this agent (applies its prompt + tool scope).
      agent: task.assignedAgent,
      agents: { [task.assignedAgent]: def },
      model,
      settingSources: ['user'],
      env: {
        ...process.env,
        AIFLEET_TASK_ID: task.id,
        AIFLEET_CALLER_AGENT: task.assignedAgent,
      },
      // Adaptive memory exposed to every agent; the server is built per-spawn
      // so memory.add/pin are caller-enforced via closure (not a shared env).
      mcpServers: {
        memory: createMemoryMcp({
          db,
          agent: task.assignedAgent,
          projectRoot: task.projectRoot,
          taskId: task.id,
          shadow: shadowRemaining > 0,
        }),
      },
      // No bypassPermissions: canUseTool mediates EVERY tool call (sandbox +
      // network egress + audit). Returning allow is the headless approval.
      canUseTool,
      ...(ctx.allowNetwork ? {} : { disallowedTools: ['WebSearch', 'WebFetch'] }),
    };

    let finalText = '';
    const q = query({ prompt: buildPrompt(task.inputJson ?? {}), options });
    live.set(task.id, q);
    try {
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionMap.set(msg.session_id, task.id);
        } else if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'tool_use') {
              emit(task, 'tool_use_pre', { tool: block.name, input: block.input as Json });
            } else if (block.type === 'text' && block.text) {
              finalText = block.text;
              emit(task, 'log', { text: block.text });
            }
          }
        } else if (msg.type === 'result') {
          const u = msg.usage;
          const usage = {
            inputTokens: Number(u?.input_tokens ?? 0),
            outputTokens: Number(u?.output_tokens ?? 0),
            cacheReadTokens: Number(u?.cache_read_input_tokens ?? 0),
          };
          // Token usage is kept for non-cost analytics (debugging long contexts,
          // model selection feedback). costUsd is recorded as 0 — phase 17
          // dropped the cost surface end-to-end.
          db.recordAgentRun({
            taskId: task.id,
            agent: task.assignedAgent,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            costUsd: 0,
            status: msg.subtype,
            startedAt,
            finishedAt: nowTs(),
          });
          if (msg.subtype === 'success') {
            if (typeof msg.result === 'string' && msg.result) finalText = msg.result;
          } else {
            const detail = msg.errors.join('; ') || msg.subtype;
            throw new Error(`agent run ${msg.subtype}: ${detail}`);
          }
        }
      }
    } catch (err) {
      live.delete(task.id);
      const message = err instanceof Error ? err.message : String(err);
      // Phase 13: a deprecated/removed model is not a transient failure —
      // retrying won't help. Block the task for one-click migration instead.
      if (isModelDeprecated(message)) {
        const suggested = resolveModel(config, task.assignedAgent);
        db.updateTask(task.id, {
          status: 'blocked',
          error: `model deprecated: ${model} — ${message}`,
        });
        emit(task, 'blocked', {
          reason: 'model_deprecated',
          bad_model: model,
          suggested,
          detail: message,
        });
        logger.warn(
          { taskId: task.id, badModel: model, suggested },
          'task blocked: model deprecated',
        );
        const depSummary = `model ${model} deprecated; choose replacement (suggested ${suggested})`;
        void alerts.notify('model_deprecated', {
          taskId: task.id,
          projectRoot: task.projectRoot,
          summary: depSummary,
        });
        queueRetrospector(task);
        return;
      }
      onFailure(task, message);
      return;
    }
    live.delete(task.id);

    const output = parseAgentJson(finalText);

    // Pre-completion security gate: a root task cannot transition to done
    // while the project requires a pass and a blocking finding is unresolved.
    if (task.parentId === null && readProjectPolicy(task.projectRoot).requireSecurityPass) {
      const gate = unresolvedSecurityBlock(db, task.rootId);
      if (gate.blocked) {
        db.updateTask(task.id, {
          status: 'blocked',
          error: `security gate: ${gate.reason}`,
          ...(output !== undefined ? { outputJson: output } : {}),
        });
        emit(task, 'blocked', { security_gate: gate.reason ?? null });
        logger.warn({ taskId: task.id, reason: gate.reason }, 'root task blocked by security gate');
        void alerts.notify('security_blocking_finding', {
          taskId: task.id,
          projectRoot: task.projectRoot,
          summary: gate.reason ?? 'blocking security finding',
        });
        queueRetrospector(task);
        return;
      }
    }

    db.updateTask(task.id, {
      status: 'done',
      progress: 100,
      ...(output !== undefined ? { outputJson: output } : {}),
    });
    emit(task, 'completed', output ?? { note: 'no structured output parsed' });
    logger.info({ taskId: task.id, agent: task.assignedAgent }, 'agent run complete');

    if (task.assignedAgent === 'retrospector') {
      // The retrospector just recorded lessons — refresh the project's hot
      // tier (no-op while the project is still inside its shadow window).
      const remaining = Math.max(
        0,
        config.memory.shadow_runs - completedRetrospectorRuns(db, task.projectRoot),
      );
      const wrote = regenerateHotTier(db, task.projectRoot, { shadowRemaining: remaining });
      logger.info(
        {
          taskId: task.id,
          project: task.projectRoot,
          hotTierWritten: wrote,
          shadowRemaining: remaining,
        },
        'retrospector complete; hot tier refreshed',
      );
    } else {
      if (task.parentId === null) {
        void alerts.notify('goal_completed', {
          taskId: task.id,
          projectRoot: task.projectRoot,
          summary: task.title,
        });
      }
      queueRetrospector(task);
    }
  }

  return {
    spawnAgent,
    inFlight: () => live.size,
    shutdown: async () => {
      for (const t of retryTimers.values()) clearTimeout(t);
      retryTimers.clear();
      await Promise.allSettled([...live.values()].map((q) => q.interrupt()));
      live.clear();
    },
  };
}
