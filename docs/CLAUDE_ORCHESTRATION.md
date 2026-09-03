# Claude Code Orchestration — "Commander" + agent team

This repo ships a multi-agent setup built on **Claude Code** (Anthropic's CLI
coding agent). One Claude session acts as a **commander** (team lead) that plans
a task, spawns specialized **teammates**, assigns and supervises their work, then
verifies and integrates the result.

> Note on terminology: this is a *Claude Code* orchestration that runs inside
> this repository/VM. It is a separate agent system from the Cursor agent — you
> are wiring **your Claude subscription** into a CLI commander that drives
> multiple Claude worker agents, all operating on this codebase.

## Architecture

```
                 you ── task ──▶  COMMANDER  (claude, team lead)
                                     │  plans, creates a shared task list,
                                     │  assigns work, supervises, integrates
                 ┌───────────────────┼───────────────────────┬───────────────┐
                 ▼                   ▼                       ▼               ▼
           researcher        frontend-engineer       supabase-engineer   qa-verifier
        (read-only map)     (React/TS/Vite UI)       (SQL/RPC/RLS)       (runs gates)
                                     │                       │
                                     └───────▶ code-reviewer ◀┘  (final review)
```

- **Commander**: the interactive `claude` session. Enabled as a team lead via the
  experimental Agent Teams feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). It
  owns the shared task list and coordinates everyone.
- **Teammates**: defined as project subagents in `.claude/agents/`. With Agent
  Teams enabled, a named subagent the commander spawns launches as a teammate
  with its own context window. Definitions are version-controlled so the whole
  team improves them together.

Files that make this work:

| Path | Purpose |
| --- | --- |
| `.claude/settings.json` | Enables Agent Teams; sets a safe permission allow/deny list. |
| `.claude/agents/*.md` | The five specialized teammates (system prompts + tools). |
| `.claude/commands/commander.md` | The `/commander <task>` slash command (the lead's playbook). |
| `CLAUDE.md` | Project memory every session/teammate loads (canonical commands + mandates). |
| `scripts/claude-orchestrator/bootstrap.sh` | Installs the CLI, bypasses onboarding, checks the credential. |
| `scripts/claude-orchestrator/commander.sh` | Launches the commander for a task. |

## One-time: add your Claude subscription (secure)

The commander authenticates with **your Claude subscription** (Pro / Max / Team /
Enterprise) using a long-lived OAuth token. This VM is headless, so generate the
token on a machine that has a browser, then hand it to the environment as a
secret. **Never commit the token or paste it into chat.**

1. On your local machine (with Claude Code installed), run:

   ```bash
   claude setup-token
   ```

   Approve access in the browser. It prints a one-year token starting with
   `sk-ant-oat01-...` and does **not** save it anywhere — copy it now.

2. In Cursor, open the **Secrets** panel (right of the chat) and add:

   - Name: `CLAUDE_CODE_OAUTH_TOKEN`
   - Value: the token you copied

   Cursor injects secrets as environment variables into new Cloud Agent VMs, so
   the commander picks it up automatically on the next run. (Locally, you can
   instead `export CLAUDE_CODE_OAUTH_TOKEN=...` in your shell.)

Notes:
- The token authenticates with your subscription and can make model requests
  only (no Remote Control / connectors). Regenerate it yearly.
- If you would rather bill against API credits, set `ANTHROPIC_API_KEY` instead —
  the bootstrap accepts either. Do not set both.
- The token grants access to your Claude account; treat it like a password.

## Run it

```bash
# 1. Install the CLI, bypass onboarding, verify the credential is present:
scripts/claude-orchestrator/bootstrap.sh

# 2. Give the commander a task (interactive — Agent Teams needs a live session):
scripts/claude-orchestrator/commander.sh "Add a class-rank badge to the student home page"

# …or open an interactive commander and type: /commander <your task>
scripts/claude-orchestrator/commander.sh
```

For fully autonomous runs inside a sandboxed VM (e.g. a Cloud Agent with no
secrets you care about), you can skip permission prompts:

```bash
CLAUDE_ORCHESTRATOR_YOLO=1 scripts/claude-orchestrator/commander.sh "…"
```

## How the commander works

The `/commander` playbook (`.claude/commands/commander.md`) has the lead:
plan → create a shared task list → send `researcher` to map the code →
assign front-end work to `frontend-engineer` and DB work to `supabase-engineer`
in parallel → supervise and relay the interface contract between them →
verify with `qa-verifier` → final `code-reviewer` pass → integrate and report.
It stages changes with git but does not push or open a PR unless you ask.

The team is bound by the repo mandates in `.cursor/rules/` and `CLAUDE.md`: no
demo/fake data in student-facing routes, multi-tenant `school_id` safety,
render-safety, additive migrations, and never committing secrets.

## Requirements & limitations

- Requires a Claude **subscription** (Pro/Max/Team/Enterprise) or API credits.
  The free plan does not include Claude Code.
- **Agent Teams is experimental** and needs an *interactive* session — teammates
  are not spawned under `-p/--print`/SDK. That is why `commander.sh` runs
  interactively.
- Split-pane teammate views need `tmux` or iTerm2; otherwise teammates run
  in-process in the same terminal. This is cosmetic.
- Behavior tracks Claude Code ≥ 2.1.178 (Agent Teams) / 2.1.198 (subagent file
  conventions). Verified against 2.1.236.
