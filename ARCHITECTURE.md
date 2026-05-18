# ai-fleet — Architecture

A pnpm monorepo: **daemon** (orchestrator + Claude Agent SDK host + HTTP/WS),
**dashboard** (Next.js 15 live UI), **cli** (`ai-fleet`), **agents/** (global
subagent definitions), **profiles/**, **migrations/**, **scripts/**,
**deploy/**.

## The 10 build phases (for future contributors)

1. **Bootstrap** — pnpm workspace, strict TS (ES2022/NodeNext), eslint/prettier, git baseline.
2. **Agents** — 10 global subagent markdown defs + `link-agents.sh` (idempotent symlinks into `~/.claude/agents`).
3. **State** — SQLite (`~/.aifleet/state.db`), raw-DDL migrations, zod-typed `FleetDb` (tasks/events/agent_runs, DAG-aware `getReadyTasks`).
4. **Daemon + hooks** — `config.ts`, `pricing.ts`, `redact.ts`; `spawn.ts` runs each task as its agent via the Agent SDK, streams into events; `loop.ts` p-limit scheduler + hourly cost cap; Fastify `server.ts` (`/healthz`,`/metrics`,`/tasks`,`/events`,`/ws`); `aifleet-daemon`; Claude hooks stream tool calls back.
5. **Dashboard** — Next 15 App Router; server components read the shared SQLite read-only; `/api/stream` bridges one daemon WS to SSE; kanban/goals/task/agents/cost; live via streamed `router.refresh()`.
6. **CLI** — `ai-fleet` (init/up/down/submit/status/logs/cost/stop/doctor) under pm2; `init` writes `.aifleet.yaml` + `CLAUDE.md` from a profile.
7. **React-aware** — `detect.ts` (framework/state/styling/router/testing); `profiles/react.md` template rendered into `CLAUDE.md` (preserving `# User-authored`); project agent overrides; `frontend-architect` + `a11y-auditor`.
8. **Security** — `security-auditor` agent + daemon pre-completion gate; `sandbox.ts` (path/env/network mediation via SDK `canUseTool`); `audit.ts` (append-only JSONL); cost circuit breakers; prompt-injection wrapping.
9. **Adaptive memory** — `memories` + FTS5 (migration 002); per-spawn MCP `memory` server (search/add/list/pin); `retrospector` auto-queued on every terminal root; hot tier = `## Learned conventions` in `CLAUDE.md`; shadow rail; `ai-fleet memory …`; dashboard `/memory`.
10. **Ship** — `deploy/` (Dockerfile + compose + systemd); cron `scheduler.ts` (migration 003, seeded jobs); `alerts.ts` (slack/discord/generic_post); multi-project; `smoke-e2e.ts`; these docs.

## Request/data flow

`ai-fleet submit` → daemon `POST /tasks` → `loop.ts` claims ready tasks
(global `max_concurrent_agents`, across projects) → `spawn.ts` runs the agent
(sandbox + memory MCP + audit) → events stream to SQLite + `/ws` → dashboard
re-renders. On a terminal root: security gate, then auto-retrospector, then
hot-tier refresh and alerts.

## Portability (what to sync / commit)

- **Global agents** `~/.claude/agents/*.md` — portable: sync the ai-fleet
  repo to a new machine and re-run `scripts/link-agents.sh`.
- **Project overrides** `<project>/.claude/agents/*.md` — **commit these**;
  Claude Code precedence makes project scope win automatically.
- **Project config** `<project>/.aifleet.yaml` — **commit it**; secrets stay
  in env / `deploy/.env`, never in the file.
- **`<project>/CLAUDE.md`** including the regenerated `## Learned
  conventions` section — **commit it** to share learned patterns with
  teammates.
- **Cold memory / audit / state** live in `~/.aifleet` (the Docker `/data`
  volume) — machine-local; export/share lessons with
  `ai-fleet memory export|import`.

## Notable deliberate deviations

- CLI package stays `@ai-fleet/cli` + `private:true` for monorepo
  consistency; publishing is flipping `private` and the scope (metadata is
  prepared: `files`, `prepublishOnly`, `postinstall`).
- Hot-tier regeneration and the retrospector trigger are **daemon-enforced**
  (deterministic, free) in addition to the orchestrator prompt.
- Dashboard uses server components + streamed `router.refresh()` rather than
  SWR-cache mutation (simpler for a server-rendered board).
