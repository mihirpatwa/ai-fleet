// Control + observability plane. Fastify on config.server_port exposes health,
// Prometheus metrics, task CRUD, the hook event-ingestion endpoint, and a
// WebSocket that fans out every freshly-inserted event row in real time.
import { basename } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { FleetBus, SessionTaskMap } from './bus.js';
import type { FleetConfig } from './config.js';
import { fleetConfigSchema, saveConfig } from './config.js';
import { EVENT_TYPES, TASK_STATUSES, type FleetDb, type TaskStatus } from './db.js';
import { recordAndBroadcast } from './events.js';
import { onToolUsePost, onToolUsePre } from './hooks.js';
import {
  PRESETS as MCP_PRESETS,
  deleteServer as deleteMcpServer,
  exportServers as exportMcpServers,
  importServers as importMcpServers,
  listMergedServers as listMcpServers,
  probeServer as probeMcpServer,
  upsertServer as upsertMcpServer,
  type McpServerConfig,
} from './mcp/registry.js';
import {
  createScheduled as createScheduledRow,
  deleteScheduled as deleteScheduledRow,
  listScheduled as listScheduledFromDb,
  previewRuns as cronPreview,
  runScheduledNow as runScheduledNowFn,
  updateScheduled as updateScheduledRow,
} from './scheduler.js';
import {
  AZURE_USERS_TTL_MS,
  addComment as azureAddComment,
  attachmentCacheStats as azureAttachmentStats,
  clearAttachmentCache as azureAttachmentClear,
  fetchAttachment as azureFetchAttachment,
  getWorkItem as azureGetWorkItem,
  listComments as azureListComments,
  listProjectUsers as azureListUsers,
  listStatesForType as azureListStates,
  listWorkItems as azureListWorkItems,
  updateWorkItem as azureUpdateWorkItem,
  validateConnection as azureValidate,
} from './azure/client.js';
import {
  clearConnection as clearAzureConnection,
  currentPat as currentAzurePat,
  currentState as currentAzureState,
  saveConnection as saveAzureConnection,
  writePat as writeAzurePat,
} from './azure/storage.js';
import type { ListFilter as AzureListFilter, WorkItemType } from './azure/types.js';
import type { ModelRegistry } from './models.js';
import { capability as nativePickerCapability, nativePick } from './native-picker.js';
import { PROVIDERS, findProvider } from './providers/registry.js';
import {
  applyConnect,
  clearSecretFor,
  clearState,
  currentState,
  envKeyFor,
  loadState,
  saveState,
} from './providers/storage.js';
import type { AuthMethod, ConnectRequest, ProviderName } from './providers/types.js';
import { validateProvider } from './providers/validate.js';
import { resolvePath } from './resolve.js';
import { deleteRecentProject, listRecentProjects, touchRecentProject } from './recents.js';
import { deleteMemory, getMemory, listMemories, pinMemory, updateLesson } from './memory.js';

export interface ServerDeps {
  db: FleetDb;
  config: FleetConfig;
  bus: FleetBus;
  sessionMap: SessionTaskMap;
  logger: Logger;
  /** Phase-13 dynamic model registry. */
  models: ModelRegistry;
  /** Live SDK query count, surfaced in /metrics. */
  inFlight?: () => number;
}

const createTaskBody = z
  .object({
    goal: z.string().min(1),
    project_root: z.string().min(1),
    agent: z.string().min(1).optional(),
    // Phase 13: per-task model override (honoured for the whole task tree
    // when config.model_selection.per_task_allow_override is set).
    model_override: z.string().min(1).optional(),
    // Phase 18d: SDK reasoning effort for the run. Mapped per-provider in
    // spawn.ts; Claude SDK exposes this as AgentDefinition.effort.
    effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  })
  .strict();

const postEventBody = z
  .object({
    task_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    event_type: z.enum(EVENT_TYPES),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_output: z.unknown().optional(),
  })
  .strict();

function prom(
  lines: Array<[string, string, 'gauge' | 'counter', Array<[Record<string, string>, number]>]>,
): string {
  const out: string[] = [];
  for (const [name, help, type, samples] of lines) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) {
      const lbl = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      out.push(`${name}${lbl ? `{${lbl}}` : ''} ${value}`);
    }
  }
  return out.join('\n') + '\n';
}

// Changing one of these can't take effect without a daemon restart: the
// logger level and HTTP port are bound at startup, and the loop's setInterval
// + p-limit gate are created once from poll_interval_ms / max_concurrent_agents.
const DISRUPTIVE_KEYS = [
  'server_port',
  'log_level',
  'poll_interval_ms',
  'max_concurrent_agents',
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursive merge of `patch` into `base` (objects deep, scalars/arrays replace). */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { db, config, bus, sessionMap, logger, models } = deps;
  // Fastify's own request logger stays off: the daemon logs notable events
  // through its pino instance and exposes the rest via /metrics. (Passing a
  // typed pino instance here would also rebind the FastifyInstance logger
  // generic and break the declared return type under exactOptionalPropertyTypes.)
  // t16: Fastify defaults bodyLimit to 1 MB. MCP import payloads, larger
  // task input_json blobs, and future attachment uploads can blow past
  // that. 8 MB is a safe upper bound for "local control plane" use; if a
  // future endpoint needs more, raise here.
  const app = Fastify({ bodyLimit: 8 * 1024 * 1024 });
  await app.register(fastifyWebsocket);

  app.get('/healthz', () => ({ ok: true, uptime: process.uptime() }));

  app.get('/metrics', (_req, reply) => {
    const statusRows = db.raw
      .prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status')
      .all() as Array<{ status: string; c: number }>;
    const byStatus = new Map(statusRows.map((r) => [r.status, r.c]));
    const events = db.raw.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number };
    const body = prom([
      ['aifleet_up', 'Daemon liveness', 'gauge', [[{}, 1]]],
      ['aifleet_uptime_seconds', 'Process uptime', 'gauge', [[{}, Math.floor(process.uptime())]]],
      [
        'aifleet_tasks',
        'Task count by status',
        'gauge',
        TASK_STATUSES.map(
          (s) => [{ status: s }, byStatus.get(s) ?? 0] as [Record<string, string>, number],
        ),
      ],
      ['aifleet_events_total', 'Total recorded events', 'counter', [[{}, events.c]]],
      [
        'aifleet_agents_in_flight',
        'Currently streaming SDK queries',
        'gauge',
        [[{}, deps.inFlight ? deps.inFlight() : 0]],
      ],
    ]);
    void reply.header('content-type', 'text/plain; version=0.0.4');
    return body;
  });

  app.post('/tasks', (req, reply) => {
    // q11: server-side gate. The dashboard already disables [+ New goal] when
    // disconnected, but a direct API caller (CLI, curl) would otherwise spawn
    // an agent with no credentials and burn retries on hard auth failures.
    const provider = currentState();
    if (!provider.connected) {
      void reply.code(409);
      return { error: provider.error ?? 'no AI provider connected' };
    }
    const parsed = createTaskBody.safeParse(req.body);
    if (!parsed.success) {
      void reply.code(400);
      return { error: 'invalid body', detail: parsed.error.flatten() };
    }
    const { goal, project_root, agent, model_override, effort } = parsed.data;
    const task = db.createTask({
      projectRoot: project_root,
      title: goal,
      assignedAgent: agent ?? 'orchestrator',
      // Superset the subagents' input schemas read: orchestrator wants
      // `goal`+`repoRoot`, doc-writer/others want `task`+`repoRoot`.
      inputJson: {
        goal,
        task: goal,
        repoRoot: project_root,
        ...(model_override ? { model_override } : {}),
        ...(effort ? { effort } : {}),
      },
    });
    // Phase 14: remember this folder for the header "Recent" section.
    try {
      touchRecentProject(db, project_root, basename(project_root) || project_root);
    } catch (err) {
      logger.warn({ err }, 'recent_projects update failed');
    }
    logger.info({ taskId: task.id, agent: task.assignedAgent }, 'task created via API');
    void reply.code(201);
    return task;
  });

  app.get('/tasks', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const status =
      q['status'] && (TASK_STATUSES as readonly string[]).includes(q['status'])
        ? (q['status'] as TaskStatus)
        : undefined;
    return db.queryTasks({
      ...(status ? { status } : {}),
      ...(q['project_root'] ? { project: q['project_root'] } : {}),
    });
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    return task;
  });

  // Dashboard task actions. Status transitions reuse the same db.updateTask
  // path the loop uses; a log event is broadcast so the UI reflects it live.
  app.post<{ Params: { id: string } }>('/tasks/:id/cancel', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    const terminal = ['done', 'failed', 'cancelled'];
    if (terminal.includes(task.status)) {
      void reply.code(409);
      return { error: `task already ${task.status}` };
    }
    const updated = db.updateTask(task.id, { status: 'cancelled' });
    recordAndBroadcast(db, bus, {
      taskId: task.id,
      agent: task.assignedAgent,
      type: 'log',
      payloadJson: { action: 'cancelled via dashboard' },
    });
    logger.info({ taskId: task.id }, 'task cancelled via API');
    return updated;
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/retry', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    if (task.status !== 'failed') {
      void reply.code(409);
      return { error: `only failed tasks can be retried (is ${task.status})` };
    }
    const updated = db.updateTask(task.id, {
      status: 'queued',
      error: null,
      retryCount: 0,
    });
    recordAndBroadcast(db, bus, {
      taskId: task.id,
      agent: task.assignedAgent,
      type: 'log',
      payloadJson: { action: 'retry requeued via dashboard' },
    });
    logger.info({ taskId: task.id }, 'task retried via API');
    return updated;
  });

  // Phase-9 memory surface (dashboard reads + per-row actions).
  app.get('/memory', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    return listMemories(db, {
      ...(q['project_root'] ? { projectRoot: q['project_root'] } : {}),
      ...(q['agent'] ? { agent: q['agent'] } : {}),
      limit: q['limit'] ? Number(q['limit']) : 200,
    });
  });

  app.post<{ Params: { id: string } }>('/memory/:id/pin', (req, reply) => {
    const m = getMemory(db, req.params.id);
    if (!m) {
      void reply.code(404);
      return { error: 'memory not found' };
    }
    const body = (req.body ?? {}) as { pinned?: unknown };
    pinMemory(db, req.params.id, body.pinned === true);
    return getMemory(db, req.params.id);
  });

  app.patch<{ Params: { id: string } }>('/memory/:id', (req, reply) => {
    const m = getMemory(db, req.params.id);
    if (!m) {
      void reply.code(404);
      return { error: 'memory not found' };
    }
    const body = (req.body ?? {}) as { lesson?: unknown };
    if (body.lesson === undefined) {
      void reply.code(400);
      return { error: 'body.lesson required' };
    }
    updateLesson(db, req.params.id, body.lesson);
    return getMemory(db, req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/memory/:id', (req, reply) => {
    const m = getMemory(db, req.params.id);
    if (!m) {
      void reply.code(404);
      return { error: 'memory not found' };
    }
    deleteMemory(db, req.params.id);
    return { ok: true, id: req.params.id };
  });

  app.get('/events', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const since = q['since'] ? Number(q['since']) : undefined;
    return db.listEvents({
      ...(q['task_id'] ? { taskId: q['task_id'] } : {}),
      ...(since !== undefined && Number.isFinite(since) ? { sinceId: since } : {}),
      order: 'asc',
      limit: 1000,
    });
  });

  app.post('/events', (req, reply) => {
    const parsed = postEventBody.safeParse(req.body);
    if (!parsed.success) {
      void reply.code(400);
      return { error: 'invalid body', detail: parsed.error.flatten() };
    }
    const b = parsed.data;
    const taskId = b.task_id ?? (b.session_id ? sessionMap.get(b.session_id) : undefined);
    const payload: Record<string, unknown> = {};
    if (b.tool_name !== undefined) payload['tool'] = b.tool_name;
    if (b.tool_input !== undefined) payload['input'] = b.tool_input;
    if (b.tool_output !== undefined) payload['output'] = b.tool_output;
    const row = recordAndBroadcast(db, bus, {
      ...(taskId ? { taskId } : {}),
      type: b.event_type,
      ...(Object.keys(payload).length ? { payloadJson: payload as never } : {}),
    });

    // Phase 12: capture file edits for the live diff view. Best-effort — a
    // failure here must never break event ingestion.
    if (
      taskId &&
      b.tool_name &&
      (b.event_type === 'tool_use_pre' || b.event_type === 'tool_use_post')
    ) {
      try {
        const task = db.getTask(taskId);
        if (task) {
          const ctx = {
            taskId,
            agent: task.assignedAgent,
            projectRoot: task.projectRoot,
            toolName: b.tool_name,
            toolInput: b.tool_input,
          };
          if (b.event_type === 'tool_use_pre') onToolUsePre(db, bus, ctx);
          else onToolUsePost(db, bus, ctx);
        }
      } catch (err) {
        logger.warn({ err, taskId }, 'file-edit capture failed');
      }
    }

    void reply.code(201);
    return row;
  });

  // Phase 12: file edits captured by hooks.ts, for the dashboard Code tab.
  app.get('/file-edits', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    if (!q['task_id']) return [];
    return db.raw
      .prepare(
        `SELECT id, task_id AS taskId, agent, file_path AS filePath,
                lines_added AS linesAdded, lines_removed AS linesRemoved, ts
           FROM file_edits WHERE task_id = ? ORDER BY id ASC`,
      )
      .all(q['task_id']);
  });

  app.get<{ Params: { id: string } }>('/file-edits/:id', (req, reply) => {
    const row = db.raw
      .prepare(
        `SELECT id, task_id AS taskId, agent, file_path AS filePath,
                before_content AS beforeContent, after_content AS afterContent,
                diff_unified AS diffUnified, lines_added AS linesAdded,
                lines_removed AS linesRemoved, ts
           FROM file_edits WHERE id = ?`,
      )
      .get(Number(req.params.id));
    if (!row) {
      void reply.code(404);
      return { error: 'file edit not found' };
    }
    return row;
  });

  // ---------------------- Phase 13: model selection ----------------------

  app.get('/models', () => models.list());

  app.get('/models/active', () => ({
    default: config.model_selection.default,
    orchestrator: config.model_selection.orchestrator,
    per_task_allow_override: config.model_selection.per_task_allow_override,
  }));

  // Mutates the shared in-memory config (resolveModel reads it live on the
  // next spawn) and persists to config.yaml. Only `default` and `orchestrator`
  // are accepted — phase 18 dropped per-agent overrides.
  app.put<{ Params: { name: string } }>('/models/agent/:name', (req, reply) => {
    const body = (req.body ?? {}) as { model_id?: unknown };
    const id = body.model_id;
    if (typeof id !== 'string' || id.length === 0) {
      void reply.code(400);
      return { error: 'body.model_id (string) required' };
    }
    if (!models.has(id)) {
      void reply.code(400);
      return { error: `unknown model_id: ${id}`, valid: models.ids() };
    }
    const name = req.params.name;
    const ms = config.model_selection;
    if (name === 'default') ms.default = id;
    else if (name === 'orchestrator') ms.orchestrator = id;
    else {
      void reply.code(400);
      return { error: `unsupported slot: ${name} (use 'default' or 'orchestrator')` };
    }
    try {
      saveConfig(config);
    } catch (err) {
      logger.warn({ err }, 'model selection applied in-memory but config.yaml write failed');
    }
    logger.info({ name, model: id }, 'model selection updated');
    return {
      default: ms.default,
      orchestrator: ms.orchestrator,
      per_task_allow_override: ms.per_task_allow_override,
    };
  });

  app.post('/models/refresh', async () => ({ data: await models.refresh() }));

  // One-click migration for a task blocked because its model was deprecated:
  // stamp the current global default as the override and requeue it.
  app.post<{ Params: { id: string } }>('/models/migrate-task/:id', (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) {
      void reply.code(404);
      return { error: 'task not found' };
    }
    if (task.status !== 'blocked') {
      void reply.code(409);
      return { error: `task is ${task.status}, not blocked` };
    }
    const replacement = config.model_selection.default;
    const input =
      task.inputJson && typeof task.inputJson === 'object' && !Array.isArray(task.inputJson)
        ? (task.inputJson as Record<string, unknown>)
        : {};
    const updated = db.updateTask(task.id, {
      status: 'queued',
      error: null,
      retryCount: 0,
      inputJson: { ...input, model_override: replacement },
    });
    recordAndBroadcast(db, bus, {
      taskId: task.id,
      agent: task.assignedAgent,
      type: 'log',
      payloadJson: { action: 'model migrated via dashboard', model: replacement },
    });
    logger.info({ taskId: task.id, model: replacement }, 'task migrated to current default model');
    return updated;
  });

  // ---------------------- Phase 13: settings/config ----------------------

  app.get('/config', () => config);

  // Partial deep-merge → re-validate via the zod schema → mutate the SHARED
  // config object (loop/spawn read it live) → persist. Disruptive keys apply
  // only after a restart; report which so the UI can show a banner.
  app.put('/config', (req, reply) => {
    const patch = req.body;
    if (!isPlainObject(patch)) {
      void reply.code(400);
      return { error: 'body must be a JSON object (partial config)' };
    }
    const merged = deepMerge(config as unknown as Record<string, unknown>, patch);
    const parsed = fleetConfigSchema.safeParse(merged);
    if (!parsed.success) {
      void reply.code(400);
      return { error: 'invalid config', detail: parsed.error.flatten() };
    }
    const restartNeeded = DISRUPTIVE_KEYS.filter(
      (k) => JSON.stringify(config[k]) !== JSON.stringify(parsed.data[k]),
    );
    Object.assign(config, parsed.data);
    try {
      saveConfig(config);
    } catch (err) {
      logger.warn({ err }, 'config applied in-memory but config.yaml write failed');
    }
    logger.info({ keys: Object.keys(patch), restartNeeded }, 'config updated via API');
    return { ok: true, restartNeeded, config };
  });

  // ------------------ Phase 14: directory resolver ------------------

  app.post('/resolve-path', (req, reply) => {
    const b = (req.body ?? {}) as {
      hint_name?: unknown;
      hint_entries?: unknown;
      type_path?: unknown;
    };
    const { code, result } = resolvePath(db, config.directory_search_roots, {
      ...(typeof b.hint_name === 'string' ? { hint_name: b.hint_name } : {}),
      ...(Array.isArray(b.hint_entries) ? { hint_entries: b.hint_entries.map(String) } : {}),
      ...(typeof b.type_path === 'string' ? { type_path: b.type_path } : {}),
    });
    void reply.code(code);
    return result;
  });

  app.get('/recent-projects', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const limit = q['limit'] ? Number(q['limit']) : 20;
    return listRecentProjects(db, Number.isFinite(limit) ? limit : 20);
  });

  // Absolute paths contain '/', which a Fastify :path param can't carry
  // safely — take it as ?path= instead (the phase spec's /:path form is the
  // intent; this is the robust shape).
  app.delete('/recent-projects', (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const p = q['path'];
    if (!p) {
      void reply.code(400);
      return { error: 'query ?path= (absolute path) required' };
    }
    if (!deleteRecentProject(db, p)) {
      void reply.code(404);
      return { error: 'not found', path: p };
    }
    return { ok: true, path: p };
  });

  // ---------------- Phase 15: cross-OS native folder/file picker ----------------
  // The dashboard probes capability so it can show a helpful banner when the
  // daemon host is headless; the POST opens the OS dialog and returns the
  // chosen absolute path (already denylist-filtered).

  app.get('/native-picker/capability', () => nativePickerCapability());

  app.post('/native-picker', async (req, reply) => {
    const b = (req.body ?? {}) as { mode?: unknown; title?: unknown };
    const mode = b.mode === 'file' ? 'file' : 'directory';
    const title = typeof b.title === 'string' ? b.title : undefined;
    const result = await nativePick(mode, title);
    if (result.ok) return { path: result.path };
    if ('cancelled' in result) {
      void reply.code(200);
      return { cancelled: true };
    }
    void reply.code(503);
    return { error: result.unavailable };
  });

  // ---------------- Phase 18e: MCP server marketplace ----------------
  // Bundled presets + user-added custom servers. spawn.ts merges the enabled
  // set into Claude SDK options.mcpServers per task. State lives in
  // ~/.aifleet/mcp-servers.json.

  app.get('/mcp-servers', () => ({
    servers: listMcpServers(),
    presets: MCP_PRESETS,
  }));

  // Upsert (enable/disable a preset or edit/add a custom).
  app.put<{ Params: { name: string } }>('/mcp-servers/:name', (req, reply) => {
    const b = (req.body ?? {}) as Partial<McpServerConfig>;
    const name = req.params.name;
    if (!name) {
      void reply.code(400);
      return { error: 'name param required' };
    }
    if (typeof b.command !== 'string' || !Array.isArray(b.args)) {
      void reply.code(400);
      return { error: 'body { command: string, args: string[] } required' };
    }
    const next: McpServerConfig = {
      name,
      command: b.command,
      args: b.args.map(String),
      enabled: b.enabled === true,
      ...(typeof b.display_name === 'string' ? { display_name: b.display_name } : {}),
      ...(b.env && typeof b.env === 'object'
        ? { env: Object.fromEntries(Object.entries(b.env).map(([k, v]) => [k, String(v)])) }
        : {}),
      ...(b.preset === true ? { preset: true } : {}),
      ...(Array.isArray(b.allowed_agents)
        ? { allowed_agents: b.allowed_agents.map(String) }
        : {}),
    };
    const merged = upsertMcpServer(next);
    logger.info({ name, enabled: next.enabled }, 'mcp server upserted');
    return { servers: merged };
  });

  app.delete<{ Params: { name: string } }>('/mcp-servers/:name', (req) => {
    const merged = deleteMcpServer(req.params.name);
    logger.info({ name: req.params.name }, 'mcp server deleted');
    return { servers: merged };
  });

  // q9: share MCP config across machines. GET returns the stored rows (no
  // presets — those rebound on the target host); POST applies the payload.
  app.get('/mcp-servers/export', () => exportMcpServers());
  app.post('/mcp-servers/import', (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const mode = b['mode'] === 'replace' ? 'replace' : 'merge';
    try {
      const out = importMcpServers(b, mode);
      logger.info({ mode, count: out.count }, 'mcp servers imported');
      return out;
    } catch (err) {
      void reply.code(400);
      return { error: err instanceof Error ? err.message : 'import failed' };
    }
  });

  // p4: cheap "does this thing actually run?" probe used by Settings to show
  // a green/red dot per server. Spawns the command for up to 4s; if the
  // process is still alive then, we consider it healthy (MCP stdio servers
  // run as long as they're connected, so an immediate non-zero exit is the
  // only signal of breakage).
  app.post<{ Params: { name: string } }>('/mcp-servers/:name/probe', async (req, reply) => {
    const all = listMcpServers();
    const s = all.find((x) => x.name === req.params.name);
    if (!s) {
      void reply.code(404);
      return { ok: false, reason: `unknown mcp: ${req.params.name}` };
    }
    const result = await probeMcpServer(s);
    return result;
  });

  // ---------------- r5: Schedules CRUD ----------------

  app.get('/schedules', () => ({ schedules: listScheduledFromDb(db) }));

  // s3: live cron validator + next-fire preview for the edit modal.
  app.get('/schedules/preview', (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const cron = q['cron'] ?? '';
    const count = Math.max(1, Math.min(10, Number(q['count']) || 3));
    const next = cronPreview(cron, count);
    return { valid: next.length > 0, next };
  });

  app.post('/schedules', (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
    const cron = typeof b['cron'] === 'string' ? b['cron'].trim() : '';
    const agent = typeof b['agent'] === 'string' ? b['agent'].trim() : '';
    if (!name || !cron || !agent) {
      void reply.code(400);
      return { error: 'body { name, cron, agent } required' };
    }
    try {
      const row = createScheduledRow(db, {
        name,
        cron,
        agent,
        project_root: (b['project_root'] as string) ?? null,
        input_json: (b['input_json'] ?? {}) as never,
        enabled: b['enabled'] === false ? false : true,
      });
      logger.info({ id: row.id, name: row.name }, 'scheduled task created');
      return row;
    } catch (err) {
      void reply.code(400);
      return { error: err instanceof Error ? err.message : 'create failed' };
    }
  });

  app.patch<{ Params: { id: string } }>('/schedules/:id', (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const row = updateScheduledRow(db, req.params.id, {
        ...(typeof b['name'] === 'string' ? { name: b['name'] } : {}),
        ...(typeof b['cron'] === 'string' ? { cron: b['cron'] } : {}),
        ...(typeof b['agent'] === 'string' ? { agent: b['agent'] } : {}),
        ...('project_root' in b
          ? { project_root: (b['project_root'] as string) ?? null }
          : {}),
        ...('input_json' in b
          ? { input_json: (b['input_json'] ?? {}) as never }
          : {}),
        ...(typeof b['enabled'] === 'boolean' ? { enabled: b['enabled'] } : {}),
      });
      if (!row) {
        void reply.code(404);
        return { error: 'not found' };
      }
      return row;
    } catch (err) {
      void reply.code(400);
      return { error: err instanceof Error ? err.message : 'update failed' };
    }
  });

  app.delete<{ Params: { id: string } }>('/schedules/:id', (req, reply) => {
    const ok = deleteScheduledRow(db, req.params.id);
    if (!ok) {
      void reply.code(404);
      return { error: 'not found' };
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/schedules/:id/run', (req, reply) => {
    const out = runScheduledNowFn(db, req.params.id);
    if (!out) {
      void reply.code(404);
      return { error: 'not found' };
    }
    logger.info({ id: req.params.id, taskId: out.task_id }, 'scheduled task fired manually');
    return out;
  });

  // ---------------- Phase 18g: Azure Boards ----------------
  // Connection lives in ~/.aifleet/azure.json + AZURE_DEVOPS_PAT secret.
  // Work-item endpoints are thin wrappers around the WIQL + workitems REST
  // calls. We never persist the PAT in azure.json itself.

  app.get('/azure/connection', () => currentAzureState());

  app.post('/azure/connection', async (req, reply) => {
    const b = (req.body ?? {}) as { org_url?: unknown; project?: unknown; pat?: unknown };
    const org_url = typeof b.org_url === 'string' ? b.org_url.trim().replace(/\/+$/, '') : '';
    const project = typeof b.project === 'string' ? b.project.trim() : '';
    const pat = typeof b.pat === 'string' ? b.pat.trim() : '';
    if (!org_url || !project || pat.length < 10) {
      void reply.code(400);
      return { error: 'body { org_url, project, pat } required (PAT ≥ 10 chars)' };
    }
    const probe = await azureValidate(org_url, project, pat);
    if (!probe.ok) {
      void reply.code(401);
      return { error: probe.error ?? 'validation failed' };
    }
    writeAzurePat(pat);
    saveAzureConnection({ org_url, project, validated_at: new Date().toISOString() });
    logger.info({ org_url, project }, 'azure boards connection saved');
    return currentAzureState();
  });

  app.delete('/azure/connection', () => {
    clearAzureConnection();
    return currentAzureState();
  });

  app.get('/azure/work-items', async (req, reply) => {
    const state = currentAzureState();
    const pat = currentAzurePat();
    if (!state.connected || !pat) {
      void reply.code(409);
      return { error: state.error ?? 'azure not connected' };
    }
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const filter: AzureListFilter = {
      ...(q['type'] ? { type: q['type'].split(',') as WorkItemType[] } : {}),
      ...(q['state'] ? { state: q['state'].split(',') } : {}),
      ...(q['assigned_to'] ? { assigned_to: q['assigned_to'] } : {}),
      ...(q['iteration_path'] ? { iteration_path: q['iteration_path'] } : {}),
      ...(q['area_path'] ? { area_path: q['area_path'] } : {}),
      ...(q['tag'] ? { tag: q['tag'] } : {}),
      ...(q['search'] ? { search: q['search'] } : {}),
      ...(q['page'] ? { page: Math.max(0, Number(q['page']) || 0) } : {}),
      ...(q['pageSize']
        ? { pageSize: Math.max(1, Math.min(200, Number(q['pageSize']) || 50)) }
        : { pageSize: 50 }),
    };
    try {
      const result = await azureListWorkItems(state.org_url, state.project, pat, filter);
      return result;
    } catch (err) {
      void reply.code(502);
      return { error: err instanceof Error ? err.message : 'azure call failed' };
    }
  });

  app.get<{ Params: { id: string } }>('/azure/work-items/:id', async (req, reply) => {
    const state = currentAzureState();
    const pat = currentAzurePat();
    if (!state.connected || !pat) {
      void reply.code(409);
      return { error: state.error ?? 'azure not connected' };
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      void reply.code(400);
      return { error: 'id must be a positive integer' };
    }
    try {
      const item = await azureGetWorkItem(state.org_url, state.project, id, pat);
      return item;
    } catch (err) {
      void reply.code(502);
      return { error: err instanceof Error ? err.message : 'azure call failed' };
    }
  });

  app.patch<{ Params: { id: string } }>('/azure/work-items/:id', async (req, reply) => {
    const azureState = currentAzureState();
    const pat = currentAzurePat();
    if (!azureState.connected || !pat) {
      void reply.code(409);
      return { error: azureState.error ?? 'azure not connected' };
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      void reply.code(400);
      return { error: 'id must be a positive integer' };
    }
    const b = (req.body ?? {}) as {
      state?: unknown;
      assigned_to?: unknown;
      title?: unknown;
      tags?: unknown;
    };
    const patch: {
      state?: string;
      assigned_to?: string | null;
      title?: string;
      tags?: string;
    } = {};
    if (typeof b.state === 'string') patch.state = b.state;
    if (b.assigned_to === null || typeof b.assigned_to === 'string')
      patch.assigned_to = b.assigned_to as string | null;
    if (typeof b.title === 'string') patch.title = b.title;
    if (typeof b.tags === 'string') patch.tags = b.tags;
    if (Object.keys(patch).length === 0) {
      void reply.code(400);
      return {
        error: 'body must include at least one of { state, assigned_to, title, tags }',
      };
    }
    try {
      await azureUpdateWorkItem(azureState.org_url, azureState.project, id, patch, pat);
      const item = await azureGetWorkItem(azureState.org_url, azureState.project, id, pat);
      logger.info({ id, patch }, 'azure work item patched');
      return item;
    } catch (err) {
      void reply.code(502);
      return { error: err instanceof Error ? err.message : 'azure call failed' };
    }
  });

  app.post<{ Params: { id: string } }>('/azure/work-items/:id/comments', async (req, reply) => {
    const azureState = currentAzureState();
    const pat = currentAzurePat();
    if (!azureState.connected || !pat) {
      void reply.code(409);
      return { error: azureState.error ?? 'azure not connected' };
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      void reply.code(400);
      return { error: 'id must be a positive integer' };
    }
    const b = (req.body ?? {}) as { text?: unknown };
    if (typeof b.text !== 'string' || !b.text.trim()) {
      void reply.code(400);
      return { error: 'body.text required' };
    }
    try {
      await azureAddComment(azureState.org_url, azureState.project, id, b.text, pat);
      const comments = await azureListComments(azureState.org_url, azureState.project, id, pat);
      logger.info({ id }, 'azure work item comment posted');
      return { comments };
    } catch (err) {
      void reply.code(502);
      return { error: err instanceof Error ? err.message : 'azure call failed' };
    }
  });

  app.get<{ Params: { id: string } }>('/azure/work-items/:id/comments', async (req, reply) => {
    const state = currentAzureState();
    const pat = currentAzurePat();
    if (!state.connected || !pat) {
      void reply.code(409);
      return { error: state.error ?? 'azure not connected' };
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      void reply.code(400);
      return { error: 'id must be a positive integer' };
    }
    try {
      const comments = await azureListComments(state.org_url, state.project, id, pat);
      return { comments };
    } catch (err) {
      void reply.code(502);
      return { error: err instanceof Error ? err.message : 'azure call failed' };
    }
  });

  // t1: project members for the assignee dropdown. v7+v16: returns
  // truncated + cached_at + ttl_ms so the UI can render "cached / stale"
  // hints.
  app.get('/azure/users', async (_req, reply) => {
    const state = currentAzureState();
    const pat = currentAzurePat();
    if (!state.connected || !pat) {
      void reply.code(409);
      return { error: state.error ?? 'azure not connected' };
    }
    const result = await azureListUsers(state.org_url, state.project, pat);
    return { ...result, ttl_ms: AZURE_USERS_TTL_MS };
  });

  // States the user can filter by, per work-item type. Cached client-side
  // but always fresh from Azure to follow project customizations.
  app.get('/azure/states', async (req, reply) => {
    const state = currentAzureState();
    const pat = currentAzurePat();
    if (!state.connected || !pat) {
      void reply.code(409);
      return { error: state.error ?? 'azure not connected' };
    }
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const types = (q['type'] ? q['type'].split(',') : ['User Story', 'Feature', 'Task', 'Bug', 'Epic'])
      .filter(Boolean);
    const seen = new Set<string>();
    await Promise.all(
      types.map(async (t) => {
        const rows = await azureListStates(state.org_url, state.project, t, pat);
        rows.forEach((r) => seen.add(r));
      }),
    );
    return { states: Array.from(seen).sort() };
  });

  // t4: attachment cache observability + manual flush.
  app.get('/azure/attachment-cache', () => azureAttachmentStats());
  app.delete('/azure/attachment-cache', () => azureAttachmentClear());

  // Attachment streaming proxy. The browser hits this with the encoded Azure
  // URL; the daemon adds the PAT and pipes the response back. Keeps the
  // token out of the rendered DOM.
  app.get('/azure/attachment', async (req, reply) => {
    const azureState = currentAzureState();
    const pat = currentAzurePat();
    if (!azureState.connected || !pat) {
      void reply.code(409);
      return reply.send({ error: azureState.error ?? 'azure not connected' });
    }
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const url = q['url'];
    // t13: strict origin check. `startsWith(org_url)` previously matched
    // `https://dev.azure.com/aauti.evil.com/...` against org_url
    // `https://dev.azure.com/aauti`. Parse + compare origin + path prefix.
    let allowed = false;
    if (url) {
      try {
        const target = new URL(url);
        const trusted = new URL(azureState.org_url);
        const orgPath = trusted.pathname.replace(/\/+$/, '');
        const targetPath = target.pathname;
        allowed =
          target.origin === trusted.origin &&
          (orgPath === '' ||
            targetPath === orgPath ||
            targetPath.startsWith(orgPath + '/'));
      } catch {
        allowed = false;
      }
    }
    if (!allowed || !url) {
      void reply.code(400);
      return reply.send({ error: 'url query param required + must point at the connected org' });
    }
    try {
      const r = await azureFetchAttachment(url, pat);
      void reply.code(r.status);
      reply.header('content-type', r.contentType);
      reply.header('cache-control', 'private, max-age=300');
      // r1: r.body is a Uint8Array (in-process LRU caches the bytes). Fastify
      // sends it as the response body verbatim.
      return reply.send(Buffer.from(r.body));
    } catch (err) {
      void reply.code(502);
      return reply.send({
        error: err instanceof Error ? err.message : 'azure call failed',
      });
    }
  });

  // ---------------- Phase 18: AI provider config ----------------
  // The first-run modal hits these to learn what providers exist, persist
  // credentials and verify the connection before the dashboard unlocks.

  app.get('/providers', () => ({ providers: PROVIDERS }));

  app.get('/provider', () => currentState());

  app.delete('/provider', () => {
    // p3: drop the API key from secrets.env + process.env on disconnect.
    // Without this the key lingers and a future connect would silently auto-
    // reuse it instead of forcing the user to re-enter it.
    const prev = loadState();
    if (prev.name && prev.auth === 'api_key') {
      try {
        clearSecretFor(prev.name);
      } catch (err) {
        logger.warn({ err }, 'failed to clear secret on disconnect');
      }
    }
    clearState();
    return currentState();
  });

  app.post('/provider', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<ConnectRequest>;
    const name = b.name as ProviderName | undefined;
    const auth = b.auth as AuthMethod | undefined;
    if (!name || !auth) {
      void reply.code(400);
      return { error: 'body { name, auth } required' };
    }
    const meta = findProvider(name);
    if (!meta) {
      void reply.code(404);
      return { error: `unknown provider: ${name}` };
    }
    if (!meta.available) {
      void reply.code(400);
      return { error: meta.reason ?? `${name} unavailable` };
    }
    if (!meta.auth_methods.includes(auth)) {
      void reply.code(400);
      return { error: `${name} does not support auth=${auth}` };
    }
    if (auth === 'api_key' && (!b.api_key || b.api_key.length < 10)) {
      void reply.code(400);
      return { error: 'api_key required (>=10 chars)' };
    }
    // Probe credentials before persisting so we never leave the user with a
    // half-connected provider on disk.
    const result = await validateProvider(name, auth, b.api_key);
    if (!result.ok) {
      const state = currentState();
      saveState({ ...state, error: result.error ?? 'validation failed' });
      void reply.code(401);
      return { error: result.error ?? 'validation failed' };
    }
    const next = applyConnect({ name, auth, ...(b.api_key ? { api_key: b.api_key } : {}) });
    logger.info({ provider: name, auth }, 'provider connected');
    return next;
  });

  app.post('/provider/validate', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<ConnectRequest>;
    const name = b.name as ProviderName | undefined;
    const auth = b.auth as AuthMethod | undefined;
    if (!name || !auth) {
      void reply.code(400);
      return { ok: false, error: 'body { name, auth } required' };
    }
    const result = await validateProvider(name, auth, b.api_key);
    return result;
  });

  // Convenience: which env var holds the API key for a given provider.
  app.get<{ Params: { name: string } }>('/provider/:name/env-key', (req, reply) => {
    const name = req.params.name as ProviderName;
    if (!findProvider(name)) {
      void reply.code(404);
      return { error: `unknown provider: ${name}` };
    }
    return { env_key: envKeyFor(name) };
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = bus.onEvent((row) => {
      if (socket.readyState === 1 /* WebSocket.OPEN */) {
        try {
          socket.send(JSON.stringify(row));
        } catch (err) {
          logger.warn({ err }, 'ws send failed');
        }
      }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  return app;
}
