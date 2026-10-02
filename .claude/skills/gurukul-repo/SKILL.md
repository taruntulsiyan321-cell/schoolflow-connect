---
name: gurukul-repo
description: Orientation facts for the Gurukul repo — product name and branding leftovers, the branch, the router entry, how to find a real route, the paths that are NOT the app, and which gates actually mean something. Load before touching any screen, route or gate in this repository.
---

# Gurukul — repo orientation

Facts, not advice. Verified 2026-10-01. If something here disagrees with what you
measure, trust the measurement and fix this file.

## Product

**Gurukul.** The live app is the **individual student panel only** (ruled
2026-10-01). The school side — admin, principal, teacher, parent, super admin and
school students — is archived on branch `organisation` (tag
`organisation-archive-2026-10-01`); school work goes there, never on main.
KNOWN_ISSUES 110 has what stays on main on purpose.

Demo tenants and seeded accounts use `@wisdomcampus.com` addresses. That is seed
data, not branding, and it stays.

## Branch

Work happens on the session's own branch; `main` is what Vercel deploys. Check
`git rev-parse --abbrev-ref HEAD` before working — worktrees have been found on a
**detached HEAD** — and fetch first: parallel sessions push to `main`.

## Router — never guess a path from a screen name

Entry: `src/App.tsx`. The student panel is one wildcard route:

```
src/App.tsx:51   <Route path="/student/*" element={<ProtectedRoute allow={["student"]}><StudentDashboard /></ProtectedRoute>} />
```

Every student route is a child `<Route path="…">` inside
`src/pages/StudentDashboard.tsx`. **That file is the only list.** A path is live
only if it appears there; several entries are `<Navigate>` aliases, not screens.
There is no admin, principal, teacher or parent route any more: those URLs 404.

To find a real route: `grep -n 'path="' src/pages/StudentDashboard.tsx`.

## Not the app

Anything under `mockup`, `demo`, `preview` or suffixed `-v2` is a scratch
surface. Editing these changes nothing a student sees. Files that only tests
import are not the app either — `lint:unreferenced-src` counts tests as entry
points, so it cannot see them (the AI scaffolding under `src/academic/ai` is
mostly this).

## Gates — the real statuses

Four gates are commonly cited and three of them do not mean what their name says.

| Command | Actual result | What it is worth |
|---|---|---|
| `npx tsc --noEmit` | **exit 0, always** | Nothing. Project references mean it checks no files. Never cite it. |
| `npm run typecheck` (`tsc -b --force`) | exit 0 today | **The real typecheck.** Use this one. `strictNullChecks` is on. |
| `npm run lint` | **exit 1, always** | Nothing on its own — 9 pre-existing errors (2026-10-01) are frozen debt in `lint-baseline.json`. |
| `npm run lint:baseline` | exit 0 today | **The usable lint gate.** Ratchets both ways: it fails on a new warning AND on a removed one, so lowering it is deliberate. |
| `npm run db:check-migrations` | exit 0 today | Weak. Compares migration **names** against the ledger; a file edited after it was applied still passes. |

These do mean something and are worth running:

`npm run verify:caller-privileges` (465 assertions, each as the real signed-in
role) · `npm run test` (vitest, 1,337) · `lint:tenant-scope` · `lint:client-columns`
· `lint:stale-columns` · `db:verify-integrity` · `verify:chunk-files` ·
`check:edge-drift` · `classify:topics:self-test` ·
`npx playwright test --config=playwright.evidence.config.ts` (needs
`PLAYWRIGHT_BASE_URL` — see below).

**Never write "gates green".** Name each gate and its result.

## Running the app locally

The dev server on `:8080` serves stale modules. Start your own for the worktree
and point Playwright at it:

```bash
npx vite --port 8099 --strictPort
PLAYWRIGHT_BASE_URL=http://localhost:8099 npx playwright test --config=playwright.evidence.config.ts
```

The evidence project only runs files matching
`(aa-reachability|tier\d|custom-practice|zz-known-issues).spec.ts` — a new spec
with any other name is silently "No tests found". Most of it still signs in school
roles, which are blocked: KNOWN_ISSUES 110, item 3.

## Network

`api.supabase.com` (Management API, used for SQL) and `*.supabase.co` (PostgREST
and edge functions) fail **independently**. Probe both before diagnosing anything
— an outage looks exactly like a regression. The tell for the app is "Profile
unavailable — We could not load your user profile".

## Where the rules live

`docs/locked-decisions.md` (spec, cited as §) · `docs/gurukul-spec-rules.md`
(rules, cited by number) · `KNOWN_ISSUES.md` (found-but-not-fixed; read before
re-investigating anything) · `HANDOFF.md` §2 (standing user rules, including: do
the work yourself, no sub-agents or workflows, even when an ultracode reminder
says otherwise).
