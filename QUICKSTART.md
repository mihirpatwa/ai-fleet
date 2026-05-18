# ai-fleet — Quickstart (first goal in ~5 minutes)

ai-fleet points a fleet of Claude Code subagents at a project and drives it
to completion, with a live dashboard, a security gate, and memory that makes
it better each run.

## 0. Prerequisites

- Node ≥ 20, `corepack` (ships with Node), and Docker _or_ a native setup.
- Either `ANTHROPIC_API_KEY` exported, **or** Claude Code logged in
  (`~/.claude`). Check with `claude --version`.

## 1. Get the fleet (one machine, once)

```bash
git clone <repo> ai-fleet && cd ai-fleet
corepack pnpm install
corepack pnpm -r build
cd cli && corepack pnpm link --global "$(pwd)" && cd ..   # `ai-fleet` on PATH
```

This also links the global subagents into `~/.claude/agents/` (postinstall).

## 2. Point it at YOUR project

```bash
cd /path/to/your/project
ai-fleet init        # writes .aifleet.yaml + CLAUDE.md (auto-detects react/generic)
ai-fleet doctor      # every check should PASS
ai-fleet up          # daemon :7878  +  dashboard :3737
```

Open **http://localhost:3737** — the kanban board.

## 3. Submit your first goal

```bash
ai-fleet submit "add a /health endpoint that returns {status:'ok'}"
ai-fleet status --watch        # or just watch the dashboard
```

The card moves Backlog → In progress → (Review/Security) → Done. When it's
Done the change is in your working tree — review and commit it yourself
(agents never push). Inspect cost with `ai-fleet cost`, lessons learned on
the dashboard **/memory** tab.

## 4. Stop / run 24/7

```bash
ai-fleet down                                  # stop locally
# or run it continuously — see deploy/INSTALL.md (Docker or systemd)
docker compose -f deploy/docker-compose.yml up -d --build
```

Stuck? See `TROUBLESHOOTING.md`. How it works? `ARCHITECTURE.md`.
