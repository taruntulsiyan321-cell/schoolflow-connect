# CLAUDE.md — SchoolFlow Connect / "Vidyalaya"

Project memory for Claude Code sessions and the orchestrated agent team. Keep
this short; deep detail lives in `docs/`.

## What this is

Vite + React 18 + TypeScript + Tailwind + shadcn/ui frontend for a school
management platform, backed by a hosted Supabase project. Client-side data comes
from the Supabase JS client, RPCs, and the Academic Engine. There is no local
database — the app talks to the live Supabase project configured in `.env`.

## Canonical commands

- Install: `npm ci`
- Dev server: `npm run dev` (http://localhost:8080)
- Typecheck (hard gate): `npx tsc --noEmit -p tsconfig.app.json`
- Unit tests: `npm run test` (vitest)
- Render-safety gate: `npm run lint:render-safety`
- Production build: `npm run build`
- E2E (needs dev server): `npm run test:e2e`
- Full quality gates are defined in `.github/workflows/quality.yml`.

## Non-negotiable mandates (see `.cursor/rules/`)

- **No demo/fake data** in mounted student-facing routes. Use live Supabase /
  Academic Engine data or honest empty states (`0` / `—`). Never invent stats,
  classmates, or achievements.
- **Multi-tenant safety.** Every school-scoped table and DB function must scope by
  `school_id`; never leak across schools. See `docs/rls-policy-pattern.md`.
- **Render safety.** Route user-facing values through `@/lib/presentation` so
  `lint:render-safety` stays green — no raw internal enums/IDs on screen.
- **Migrations are additive.** Add new timestamped files under
  `supabase/migrations/`; never edit an applied migration.
- Never commit secrets; never read `.env*` into output.

## Orchestration ("commander")

This repo ships a Claude Code multi-agent setup. The lead session is the
**commander**; specialized teammates live in `.claude/agents/`. Kick off a run
with the `/commander <task>` slash command, or use
`scripts/claude-orchestrator/commander.sh "<task>"`. See
`docs/CLAUDE_ORCHESTRATION.md` for setup (including the subscription token) and
usage.
