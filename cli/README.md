# ai-fleet

The user-facing CLI for **ai-fleet** — a portable multi-agent orchestrator
that drives Claude Code subagents to autonomously work on any project you
point it at (daemon + live dashboard + adaptive memory + security gate).

```bash
ai-fleet init            # scaffold .aifleet.yaml + CLAUDE.md in the current project
ai-fleet doctor          # verify the environment
ai-fleet up              # start the daemon (7878) + dashboard (3737)
ai-fleet submit "add a /settings page with a dark-mode toggle"
ai-fleet status --watch  # live task tree
ai-fleet down            # stop
```

Other commands: `logs`, `cost`, `stop <task-id>`, `memory list|show|compact|export|import`.

See `QUICKSTART.md`, `ARCHITECTURE.md`, and `TROUBLESHOOTING.md` in the repo
for the full picture and 24/7 deployment (`deploy/`).

Requires Node ≥ 20 and either `ANTHROPIC_API_KEY` or a logged-in Claude Code.
