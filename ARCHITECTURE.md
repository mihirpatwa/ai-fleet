# ai-fleet — Architecture

A pnpm monorepo: **daemon** (orchestrator + Claude Agent SDK host + HTTP/WS),
**dashboard** (Next.js 15 + Antd v5 live UI), **cli** (`ai-fleet`), **agents/**
(global subagent definitions), **migrations/**, **scripts/**, **deploy/**.

## Build phases (history → current shape)

1. **Bootstrap** — pnpm workspace, strict TS (ES2022/NodeNext), eslint/prettier.
2. **Agents** — 10 global subagent markdown defs + `link-agents.sh` (idempotent symlinks into `~/.claude/agents`).
3. **State** — SQLite (`~/.aifleet/state.db`), raw-DDL migrations, zod-typed `FleetDb` (tasks/events/agent_runs/memories/recent_projects/file_edits, DAG-aware `getReadyTasks`).
4. **Daemon + hooks** — `config.ts` (zod schema, persisted YAML), `redact.ts`; `spawn.ts` runs each task as its agent via the Agent SDK, streams events; `loop.ts` p-limit scheduler; Fastify `server.ts` (`/healthz`,`/metrics`,`/tasks`,`/events`,`/ws`,`/provider`,`/mcp-servers`,…); Claude hooks pipe tool calls back.
5. **Dashboard** — Next 15 App Router + Antd v5; server components read the shared SQLite read-only; `/api/stream` bridges one daemon WS to SSE; kanban/goals/task/agents/memory/security/schedules/settings; live via streamed `router.refresh()`.
6. **CLI** — `ai-fleet` (init/up/down/submit/status/logs/stop/doctor) under pm2; `init` scaffolds `.aifleet.yaml` + `CLAUDE.md`.
7. **React-aware** — `detect.ts` infers framework/state/styling/router/testing; project agent overrides; `frontend-architect` + `a11y-auditor`.
8. **Security** — `security-auditor` + daemon pre-completion gate; `sandbox.ts` (path/env/network mediation via SDK `canUseTool`); `audit.ts` (append-only JSONL); cross-OS hard denylist (POSIX + Windows roots); prompt-injection wrapping.
9. **Adaptive memory** — `memories` + FTS5 (migration 002); per-spawn MCP `memory` server (search/add/list/pin); auto-queued `retrospector` on every terminal root (board hides children — single card per goal); shadow rail; `ai-fleet memory …`; dashboard `/memory`.
10. **Ship** — `deploy/` (Dockerfile + compose + systemd); cron `scheduler.ts`; `alerts.ts` (Slack/Discord/generic webhooks). State DB wiped clean for phase-17.
11. **Antd dashboard rebuild** — Next 15 + Antd v5 with `cssVar:true, hashed:false` for live dark/light theme; per-second board timers; native picker capability probe.
12. **Operator panels** — task detail tabs (Logs/Tree/Metrics/Output), shared `useTicker`.
13. **Dynamic models** — model registry, hourly refresh, per-task override on goal modal, model-deprecation banner.
14. **Directory picker** — daemon resolver + handle fingerprint search; phase-8 denylist reused.
15. **UI polish** — submit-goal modal; settings polish; cross-OS native folder picker (osascript/zenity/PowerShell on the daemon host).
16. **Stabilization** — sticky `aifleet-project` cookie, board hides children, goals filters, DB wipe.
17. **Clean slate** — drop dashboard-legacy (98MB), cost surface end-to-end (UI + daemon caps + pricing.ts), LiveAgentStrip, progress bar, stale docs.
18. **Provider abstraction + extensibility** — first-run modal, `~/.aifleet/provider.json` + `secrets.env`, reasoning-effort UI (Low/Medium/High/Max → SDK `AgentDefinition.effort`), MCP server marketplace in Settings (Chrome DevTools, Playwright, GitHub, Postgres, Filesystem) with per-server allowlist + health probe + env-var inputs, env auto-detect on first boot. Runtime still Claude-only; Codex/OpenAI cards stubbed for future adapter.

## Request/data flow

```
ai-fleet submit         dashboard /api/tasks
       │                       │
       └────►  daemon /tasks  ◄┘
                  │
                  ▼
              loop.ts  ── claims ready (max_concurrent_agents, cross-project)
                  │
                  ▼
              spawn.ts  ── Claude Agent SDK query()
                  │           ├─ canUseTool → sandbox.decideTool (denylist / env / net)
                  │           ├─ mcpServers   = memory + enabled MCPs (per-agent allowlist)
                  │           └─ effort       = task input_json.effort
                  ▼
              events  ── SQLite + bus.ws → dashboard /api/stream (SSE) → router.refresh()
                  │
                  ▼
           terminal root  ── security gate → retrospector child (hidden on board) → hot-tier CLAUDE.md → alerts.notify(*)
```

## Provider layer (phase 18)

| Aspect | Today (Stage 1+2) | Stored |
|---|---|---|
| Choice | First-run modal (Claude available; Codex stubbed) | `~/.aifleet/provider.json` |
| Auth | `api_key` or `local` (Claude Code login) | secrets in `~/.aifleet/secrets.env` (`chmod 600`, never in git) |
| Auto-detect | `ANTHROPIC_API_KEY` env on boot → synthesize claude/api_key state | — |
| Validate | Probe `https://api.anthropic.com/v1/models` before persisting | — |
| Disconnect | DELETE `/provider` clears state AND scrubs the env var from secrets.env | — |
| Chip | Header logo + name + tooltip (auth + validated_at) | — |

## MCP layer (phase 18e)

- **Storage:** `~/.aifleet/mcp-servers.json` (presets default `enabled:false`).
- **Presets:** chrome-devtools, playwright, github (needs `GITHUB_PERSONAL_ACCESS_TOKEN`), postgres (needs `DATABASE_URL`), filesystem.
- **Per-agent allowlist:** empty/undefined = all agents; otherwise whitelist (e.g. tester gets Chrome).
- **Health probe:** spawns the command for 4s; alive = ok, immediate non-zero exit = fail with stderr reason.
- **Wired into spawn:** `buildSdkMcpServers(agent)` filters by allowlist + merges with the in-process memory MCP.

## Portability (what to sync / commit)

- **Global agents** `~/.claude/agents/*.md` — re-run `scripts/link-agents.sh` on a new machine.
- **Project overrides** `<project>/.claude/agents/*.md` — **commit these**; Claude Code precedence makes project scope win automatically.
- **Project config** `<project>/.aifleet.yaml` — **commit it**; secrets stay in env / `deploy/.env`, never in the file.
- **`<project>/CLAUDE.md`** (including the regenerated `## Learned conventions` section) — **commit it** to share lessons with teammates.
- **Cold memory / audit / state** live in `~/.aifleet` (Docker `/data` volume) — machine-local; export/share with `ai-fleet memory export|import`.

## Notable deliberate deviations

- **No cost guardrails** (phase 17). User chose full removal; `max_retries=3` is the only auto-stop on runaway agents.
- **Hot-tier regeneration + retrospector trigger** are daemon-enforced (deterministic, free) in addition to the orchestrator prompt.
- **Dashboard** uses server components + streamed `router.refresh()` rather than SWR-cache mutation (simpler for a server-rendered board).
- **Modals** use `getContainer={false}` so they inherit the `cssVar`-scoped Antd theme — portals would mount outside the ConfigProvider's scope and fall back to light defaults.
- **No per-agent default-model picker** (phase 18a). Default is global; only per-task override on the goal modal + the orchestrator's separate slot.
- **CLI package** stays `@ai-fleet/cli` + `private:true` for monorepo consistency; publishing is flipping `private` and the scope.
