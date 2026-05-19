#!/usr/bin/env bash
# One command to stop ai-fleet (state in ~/.aifleet is preserved).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
node "$ROOT/cli/dist/index.js" down || true
echo "ai-fleet stopped. Your data in ~/.aifleet is kept."
