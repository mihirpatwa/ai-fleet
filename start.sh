#!/usr/bin/env bash
# One command to start ai-fleet: builds if needed, makes the `ai-fleet`
# command available, starts the daemon + dashboard, opens the dashboard.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
CLI="$ROOT/cli/dist/index.js"

echo "Starting ai-fleet…"

# 1. Build on first run (normally already built — fast skip).
if [ ! -f "$CLI" ]; then
  echo "First run: building (~1–2 min)…"
  ( cd "$ROOT" && corepack pnpm install && corepack pnpm -r build )
fi

# 1b. Re-link the global subagents every start (idempotent). Without this a
#     newly-added agent (e.g. retrospector) is missing from ~/.claude/agents
#     and its tasks fail "agent definition not found".
bash "$ROOT/scripts/link-agents.sh" >/dev/null 2>&1 || true

# 2. Make `ai-fleet` usable in any future Terminal (added once).
ALIAS="alias ai-fleet='node \"$CLI\"'"
if ! grep -qF "$ALIAS" "$HOME/.zshrc" 2>/dev/null; then
  echo "$ALIAS" >> "$HOME/.zshrc"
  echo "Added the 'ai-fleet' command to your shell (new terminals)."
fi

# 3. Start daemon (7878) + dashboard (3737). Idempotent.
node "$CLI" up || true

# 4. Open the dashboard.
open "http://localhost:3737" 2>/dev/null || true

echo
echo "──────────────────────────────────────────────"
echo " ai-fleet is RUNNING."
echo " Dashboard: http://localhost:3737  (just opened)"
echo
echo " To give it a task, open a NEW Terminal and run:"
echo "   ai-fleet submit \"create a file hello.txt that says hello world\""
echo
echo " To stop later: double-click 'Stop ai-fleet' on your Desktop."
echo "──────────────────────────────────────────────"
