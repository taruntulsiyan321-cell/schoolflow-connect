#!/usr/bin/env bash
# Idempotent bootstrap for the Claude Code "commander" orchestration.
#
# - Installs the Claude Code CLI (native installer) if it is missing.
# - Ensures ~/.local/bin is on PATH for this shell.
# - Bypasses the first-run onboarding gate so a headless OAuth token is honored.
# - Verifies a subscription credential is present (CLAUDE_CODE_OAUTH_TOKEN),
#   falling back to ANTHROPIC_API_KEY (API credits) if that is what you use.
#
# This script never prints or stores your token. Provide the token via the
# environment (e.g. a Cursor Secret named CLAUDE_CODE_OAUTH_TOKEN); see
# docs/CLAUDE_ORCHESTRATION.md.
set -euo pipefail

log() { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; }

export PATH="$HOME/.local/bin:$PATH"

# 1. Install Claude Code if absent.
if ! command -v claude >/dev/null 2>&1; then
  log "Claude Code not found — installing via the official native installer…"
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
else
  log "Claude Code already installed: $(claude --version 2>/dev/null || echo unknown)"
fi

if ! command -v claude >/dev/null 2>&1; then
  err "Claude Code install failed: 'claude' is still not on PATH."
  err "Add it manually: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
  exit 1
fi

# 2. Bypass the interactive onboarding gate. Without this, a valid
#    CLAUDE_CODE_OAUTH_TOKEN is ignored on first run and the CLI drops into the
#    interactive login/theme picker (which has no browser here). We only set
#    hasCompletedOnboarding; we never touch credentials.
CLAUDE_JSON="$HOME/.claude.json"
node - "$CLAUDE_JSON" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
let data = {};
try { data = JSON.parse(fs.readFileSync(path, 'utf8')); } catch (_) { data = {}; }
if (data.hasCompletedOnboarding !== true) {
  data.hasCompletedOnboarding = true;
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
  console.log('[bootstrap] wrote hasCompletedOnboarding=true to ' + path);
} else {
  console.log('[bootstrap] onboarding already bypassed');
}
NODE

# 3. Verify a credential is present. Prefer the subscription OAuth token.
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  log "Auth: using CLAUDE_CODE_OAUTH_TOKEN (Claude subscription)."
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  log "Auth: using ANTHROPIC_API_KEY (API credits, pay-per-use)."
else
  err "No Claude credential found in the environment."
  err ""
  err "Add your subscription token (recommended):"
  err "  1. On a machine with a browser, run:  claude setup-token"
  err "  2. Copy the printed token (starts with sk-ant-oat01-...)."
  err "  3. In Cursor, add a Secret named CLAUDE_CODE_OAUTH_TOKEN with that value."
  err "     (Secrets are injected as env vars into new Cloud Agent VMs.)"
  err ""
  err "See docs/CLAUDE_ORCHESTRATION.md for details."
  exit 2
fi

log "Ready. Claude Code $(claude --version 2>/dev/null | head -1)"
log "Next: scripts/claude-orchestrator/commander.sh \"<your task>\""
