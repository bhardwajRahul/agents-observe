#!/bin/bash
# skills/observe/scripts/cli.sh
#
# Thin wrapper that locates observe_cli.mjs relative to this script and
# exec's node with all args passed through. Lets SKILL.md call
# `scripts/cli.sh <cmd>` from inside its own dir — portable across
# Claude Code, Codex, and any other agent that follows the agentskills
# spec (which forbids reaching outside the skill dir with ../paths in
# the instructions themselves).
#
# Layout this assumes:
#   <plugin-root>/skills/observe/scripts/cli.sh   ← this file
#   <plugin-root>/hooks/scripts/observe_cli.mjs   ← target

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec node "$PLUGIN_ROOT/hooks/scripts/observe_cli.mjs" "$@"
