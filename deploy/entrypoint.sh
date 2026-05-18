#!/usr/bin/env bash
# Container entrypoint: prepare state, link agents into the image's
# ~/.claude/agents, then hand PID 1 to pm2-runtime (signals propagate; the
# daemon applies SQLite migrations itself on first open of /data/state.db).
set -euo pipefail

mkdir -p /data /root/.claude/agents

# Link the global subagents (idempotent; never fail the container on this).
CLAUDE_AGENTS_DIR=/root/.claude/agents bash /app/scripts/link-agents.sh >/dev/null 2>&1 || true

# Install the Claude event hooks into the image's user settings (idempotent).
CLAUDE_SETTINGS_PATH=/root/.claude/settings.json \
  node --import tsx /app/scripts/install-hooks.ts >/dev/null 2>&1 || true

echo "ai-fleet container starting (data=/data, daemon :7878, dashboard :3737)"
exec pm2-runtime start /app/deploy/ecosystem.config.cjs
