#!/usr/bin/env bash
# Launch the Claude Code "commander" (team lead) for this repo.
#
# Usage:
#   scripts/claude-orchestrator/commander.sh "Add a class-rank badge to the student home"
#   scripts/claude-orchestrator/commander.sh          # opens an interactive commander session
#
# The commander plans the task, spawns the specialized teammates defined in
# .claude/agents/, assigns and supervises their work, then verifies and
# integrates. Agent teams require an INTERACTIVE session, so this does not use
# -p/--print.
#
# Env toggles:
#   CLAUDE_ORCHESTRATOR_YOLO=1   Add --dangerously-skip-permissions (autonomous;
#                                only do this in a sandboxed VM with no secrets
#                                you care about — e.g. a Cloud Agent).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Ensure the CLI is installed, onboarding is bypassed, and a credential exists.
# shellcheck source=/dev/null
source "$SCRIPT_DIR/bootstrap.sh"

cd "$REPO_ROOT"

# Enable the experimental Agent Teams so the commander can spawn real teammates.
# (Also set in .claude/settings.json; exported here so it applies regardless of
# how settings are loaded.)
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

TASK="${*:-}"

CLAUDE_ARGS=()
if [ "${CLAUDE_ORCHESTRATOR_YOLO:-0}" = "1" ]; then
  echo "[commander] YOLO mode: bypassing permission prompts."
  CLAUDE_ARGS+=("--dangerously-skip-permissions")
fi

if [ -n "$TASK" ]; then
  echo "[commander] Launching commander for task: $TASK"
  exec claude "${CLAUDE_ARGS[@]}" "/commander $TASK"
else
  echo "[commander] Launching interactive commander. Type: /commander <your task>"
  exec claude "${CLAUDE_ARGS[@]}"
fi
