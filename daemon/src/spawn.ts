// The agent host. Each ready task is run through the Claude Agent SDK as the
// task's assigned subagent: its markdown definition becomes the main-thread
// agent, the SDK stream is mirrored into the events table, token usage is
// priced into agent_runs, and the final fenced-JSON message is parsed into
// the task's output_json. Failures retry with the configured backoff.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  query,
  type AgentDefinition,
  type Options,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import yaml from 'js-yaml';
import type { Logger } from 'pino';
import type { FleetBus, SessionTaskMap } from './bus.js';
import type { FleetConfig } from './config.js';
import type { FleetDb, Json, Task } from './db.js';
import { recordAndBroadcast } from './events.js';
import { computeCost } from './pricing.js';
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

/** Resolve the model for an agent per config precedence. */
export function resolveModel(config: FleetConfig, agent: string): string {
  return (
    config.per_agent_models[agent] ??
    (agent === 'orchestrator' ? config.orchestrator_model : config.default_model)
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
  const { db, config, bus, sessionMap, logger } = deps;
  const live = new Map<string, Query>();
  const retryTimers = new Map<string, NodeJS.Timeout>();

  function emit(
    task: Task,
    type: 'started' | 'log' | 'tool_use_pre' | 'completed' | 'failed',
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
    }
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

    const model = resolveModel(config, task.assignedAgent);
    db.updateTask(task.id, { status: 'running' }); // auto-stamps started_at
    const started = db.getTask(task.id);
    const startedAt = started?.startedAt ?? nowTs();
    emit(task, 'started', { agent: task.assignedAgent, model });
    logger.info({ taskId: task.id, agent: task.assignedAgent, model }, 'spawning agent');

    const def: AgentDefinition = {
      description: parsed.description,
      prompt: parsed.prompt,
      model,
      ...(parsed.tools ? { tools: parsed.tools } : {}),
    };
    const options: Options = {
      cwd: task.projectRoot,
      // Run the main thread AS this agent (applies its prompt + tool scope).
      agent: task.assignedAgent,
      agents: { [task.assignedAgent]: def },
      model,
      settingSources: ['user'],
      env: { ...process.env, AIFLEET_TASK_ID: task.id },
      // Headless daemon: no human is present to answer permission prompts.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    let finalText = '';
    const q = query({ prompt: JSON.stringify(task.inputJson ?? {}), options });
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
          let cost = computeCost(model, usage);
          if (cost === 0 && typeof msg.total_cost_usd === 'number') cost = msg.total_cost_usd;
          db.recordAgentRun({
            taskId: task.id,
            agent: task.assignedAgent,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            costUsd: cost,
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
      onFailure(task, err instanceof Error ? err.message : String(err));
      return;
    }
    live.delete(task.id);

    const output = parseAgentJson(finalText);
    db.updateTask(task.id, {
      status: 'done',
      progress: 100,
      ...(output !== undefined ? { outputJson: output } : {}),
    });
    emit(task, 'completed', output ?? { note: 'no structured output parsed' });
    logger.info({ taskId: task.id, agent: task.assignedAgent }, 'agent run complete');
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
