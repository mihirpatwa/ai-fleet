#!/usr/bin/env bash
# ai-fleet :: link-agents.sh
#
# Symlinks every agent definition in <fleet>/agents/*.md into ~/.claude/agents/
# so Claude Code discovers them globally, in any project, from any directory.
#
# Idempotent: re-running re-points stale links and is safe to run repeatedly.
# Relocation-safe: the fleet root is resolved from THIS script's own location,
# so moving the ai-fleet folder and re-running fixes every link.
#
# Override the destination with CLAUDE_AGENTS_DIR=/path ./link-agents.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$FLEET_ROOT/agents"
DEST_DIR="${CLAUDE_AGENTS_DIR:-$HOME/.claude/agents}"

if [ ! -d "$SRC_DIR" ]; then
  echo "error: agents source directory not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

shopt -s nullglob
files=("$SRC_DIR"/*.md)
shopt -u nullglob

if [ "${#files[@]}" -eq 0 ]; then
  echo "error: no *.md agent definitions found in $SRC_DIR" >&2
  exit 1
fi

linked=0
for src in "${files[@]}"; do
  name="$(basename "$src")"
  dest="$DEST_DIR/$name"
  # -s symbolic, -f replace any existing entry, -n don't descend into a dir symlink.
  ln -sfn "$src" "$dest"
  if [ ! -r "$dest" ]; then
    echo "error: created $dest but its target is not readable" >&2
    exit 1
  fi
  echo "linked  $name  ->  $src"
  linked=$((linked + 1))
done

echo "ok: $linked agent definition(s) linked into $DEST_DIR"
echo "Open a fresh Claude Code session anywhere and try: \"use the planner subagent to break down 'add a login page'\""
