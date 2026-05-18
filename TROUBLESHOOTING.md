# ai-fleet — Troubleshooting

## `ai-fleet doctor` fails

- **Claude credentials / `claude --version`** — export `ANTHROPIC_API_KEY`
  or log in Claude Code (`~/.claude`). In Docker, mount `~/.claude` (compose
  already does) or set the key in `deploy/.env`.
- **global agent symlinks** — `bash scripts/link-agents.sh` (re-links all 14
  agents; relocation-safe).
- **Claude hooks installed** — `ai-fleet init` installs them; or run
  `node --import tsx scripts/install-hooks.ts`. Hooks live in
  `~/.claude/settings.json` (or `$CLAUDE_SETTINGS_PATH`).
- **state.db writable** — ensure `~/.aifleet` (or `AIFLEET_HOME`) is
  writable; the daemon creates the DB + applies migrations on first start.

## `ai-fleet up` says health check failed

- Inspect: `pm2 logs aifleet-daemon` / `pm2 logs aifleet-dashboard`.
- Ports busy: something else on 7878/3737 — stop it or override
  (`AIFLEET_DAEMON_PORT`, `AIFLEET_DASHBOARD_PORT`).
- Dashboard not built: first `up` builds it (~30s); or `corepack pnpm -r build`.
- `pnpm` not on PATH for pm2-spawned children: ensure corepack/pnpm is
  available, or use the Docker path.

## A goal is stuck or `blocked`

- `blocked` with `security gate:` — the security-auditor found a high/critical
  issue. See the dashboard **/security** tab; the orchestrator should fix +
  re-audit, or set `require_security_pass: false` in `.aifleet.yaml` (not
  recommended) to bypass.
- `failed` with `cost_cap_exceeded` — raise `per_task_cap_usd` /
  `per_agent_hourly_cap` / `cost_cap_per_hour_usd` in `~/.aifleet/config.yaml`.
  No retry happens for cost-cap failures by design.
- Sandbox denials in the log (`sandbox: …`) — the agent tried to touch a path
  outside `project_root`/work dir, a `.env`, or the denylist. Pass
  `allow_env_read: true` / `allow_network: true` in the task input only if
  intended.

## Tasks never start

- Check the daemon is running and reachable: `curl localhost:7878/healthz`.
- Global hourly cost cap hit — see daemon log "hourly cost cap reached".
- A `running` task wedged after a crash — restarting the daemon requeues
  orphaned `running` tasks automatically.

## Memory / dashboard

- `/memory` empty — the retrospector runs only after a root task reaches a
  terminal state; the **first `shadow_runs` (default 10)** runs per project
  are stored at low confidence and kept out of `CLAUDE.md` (by design — eyeball
  them on `/memory` first). Override with `memory.shadow_runs: 0`.
- Dashboard shows nothing — it reads the same `~/.aifleet/state.db`; ensure
  `AIFLEET_DB_PATH` matches the daemon's.
- Compact noisy memory: `ai-fleet memory compact`.

## Docker

- `docker compose restart` lost state — confirm the `${HOME}/.aifleet:/data`
  volume is mounted and `AIFLEET_HOME=/data` (set in the image).
- `~` in volume paths doesn't expand — use `${HOME}` (compose does not expand
  `~`); the provided compose already does.

## Environment notes

- This repo uses `corepack pnpm` (pnpm 11). If bare `pnpm` isn't on PATH,
  prefix commands with `corepack `.
- Scheduled tasks (`scribe-daily`, `memory-compact-weekly`,
  `deps-audit-daily`) are billed agent runs; disable a row in
  `scheduled_tasks` (set `enabled=0`) if you don't want them.
