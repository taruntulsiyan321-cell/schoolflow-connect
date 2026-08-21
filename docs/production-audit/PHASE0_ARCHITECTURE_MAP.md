# Phase 0 — Architecture Map & Risk Register

**Campaign:** Full production-readiness audit and repair.
**Date generated:** 2026-08-21.
**Status:** Phase 0 (understand) complete. Phase 1 (data integrity) not started.
**Predates this doc:** `docs/QUALITY_PRODUCTION_AUDIT.md` (2026-08-02/03) and `docs/KNOWN_ISSUES.md` — both still relevant, cross-referenced below rather than duplicated. This file is the live record for the current campaign; update it in place as phases proceed rather than creating new dated copies.

---

## 1. System overview

Vite + React 18 + TypeScript + shadcn/ui SPA ("Gurukul", school name "Wisdom Campus" seeded), Supabase backend (Postgres + RLS + 258 migrations + 11 AI edge functions + 6 non-AI edge functions), React Router with five role-gated panels lazy-mounted at `/admin`, `/principal`, `/teacher`, `/student`, `/parent`. No React Query in practice despite being provisioned — ~15+ hooks hand-roll fetch/poll state via a custom `useAcademicLive` live-poll mechanism.

**Multi-tenancy:** `schools` is the tenant root (added 2026-07-30 — this is a *recently retrofitted* multi-tenant model, not original design). `profiles.school_id`, `same_school()` + `has_role()` RLS pattern, `tg_set_school_id_from_session()` trigger forces server-derived `school_id` on insert. **2026-08-20 (yesterday relative to this audit) had 10+ tenant-isolation migrations fixing real cross-school leaks** — see §3.

**Roles:** `user_roles` (one row per user, unique). `super_admin > admin > principal > teacher > student > parent` priority. Class-teacher is a per-class attribute (`teachers.class_teacher_of`), not a separate role — correctly modeled as class-scoped, not a blanket flag.

**Auth chokepoints (frontend):** `AuthProvider`/`session.ts` → role/school never trusted from client, fails closed on missing role/school. `ProtectedRoute` blocks panel mount pre-fetch (no query fires for wrong role). Service-layer chokepoints: `assertMayAccessStudent` (parentAccess.ts, AI path), `assertCanOwn`/`assertCanConsume` (academic/services/context.ts, not yet independently audited), `assertStudentContext`/`resolveStudentContext` (thin, only 1 throwing call site — real enforcement is RLS + the above).

**Core academic data flow (verified server-authoritative, well SSOT-disciplined):**
`question_bank` → practice session (`rpc_start_practice_session`) → `question_attempts` (append-only log) + `question_records` (current-state SSOT since 2026-08-04 "Practice Engine V1") → `rpc_finish_practice_session` (scores/accuracy, server-only) → `concept_mastery.mastery_score` (server-only, bands in `masteryBands.ts`: critical<40/weak<60/developing<75/strong<90/mastered≥90) → weak-concept/revision surfaces. XP/level/league: `progression_*` tables + `rpc_apply_progression`, idempotent, explicitly guarded against double-award (battle XP, DPP submit all comment "Progression Engine owns this, do not bump here"). Client has *intentional, documented* mirrors for instant UI (`deterministicEngines.ts`, `progressionMath.ts`) — drift risk is known and labeled, not hidden.

**AI (Nova) chain:** client `gatewayClient.ts` → `ai-gateway` edge fn → `resolveActor` (JWT-only identity, no client-asserted IDs) → `aiRouter.ts` (~4200 lines) kill-switches → capability lookup → `assertMayAccessStudent` → per-capability deterministic DB fetch (double `.eq(school_id).eq(student_id)` filtered) → optional cache (L1 memory + L2 `ai_solution_cache`, per-student keyed) → optional model call (Nemotron→Qwen fallback via OpenRouter, budget-capped) → `contextBuilder.ts` redacts secrets/IDs and hard-instructs "never invent attendance/marks/mastery/calendar" → render via `NovaMarkdown.tsx` (KaTeX, safe defaults). Most capabilities are `deterministic_record`/`never` (no model call at all) — only chat/explain/question-paper-generation actually invoke an LLM.

**Two brand-new, uncommitted subsystems** (not yet in production, part of active work): pgvector semantic search on `question_bank` (`match_question_bank`, hard class_level filter, no cross-class leakage), and `ai_answer_cache` (service-role-only table, zero RLS policies, meant to cache AI-generated Q&A separate from curated `question_bank` pending a future review workflow).

---

## 2. Panel/page inventory

| Panel | Dir | Shell | Layout pattern |
|---|---|---|---|
| Admin | `src/gurukul-admin/` | `AdminApp.tsx` | own sidebar/nav |
| Principal | `src/gurukul-principal/` | `PrincipalApp.tsx` (~700 lines, inline-styled) | own sidebar/nav |
| Teacher | `src/gurukul-teacher/` | `TeacherApp.tsx` | own sidebar/nav |
| Parent | `src/gurukul-parent/` | `ParentApp.tsx` | own sidebar/nav, active-child selector |
| Student | `src/gurukul/` | `src/pages/StudentDashboard.tsx` | `Layout.tsx`/`shared.tsx` (only panel with a shared layout kit) |

Student panel also carries a large set of **legacy `src/pages/student/*` routes confirmed dead** by `docs/KNOWN_ISSUES.md` (RevisionQueue, AcademicAnalytics tree) — do not resurrect without re-verifying that trace first.

---

## 3. Highest-risk areas for Phase 1+ (prioritized)

1. **RLS retrofit is still mid-sweep, and the failure pattern repeats.** Real, already-fixed-once cross-school leaks found and patched same-day on 2026-08-20: `notices` teacher/class audience leak, DPP start/publish gate bug, attendance write not restricted to class teacher, marks readable by classmates, deleted rows not refreshing academic profile. The *pattern* (new feature ships with incomplete/unscoped RLS → caught weeks later → hotfixed) is itself the finding — Phase 1/4 must independently re-verify recent tables rather than trust that the 08-20 sweep is complete, since it's a hand-driven process with no lint/CI gate against it.
2. **`ai_answer_cache` cross-school read scope.** `match_ai_answer_cache` filters by `class_level`/`subject` only, not `school_id`, despite the column existing and being set on write. Confirm with the user/team whether cross-school AI-answer sharing is intentional (shared curriculum) or a bug — content itself is not PII, but it contradicts the column's implied purpose. Fast to confirm, cheap to fix if unintended (add `school_id` param to the RPC + call site in `aiRouter.ts:3562`).
3. **Two parallel frontend RBAC mechanisms**: `ProtectedRoute`'s own `allow` prop (confirmed wired, actually enforced) vs. `src/auth/rbac.ts`'s `canAccessPath`/`ROUTE_ALLOW`/`ROLE_MODULES` (not confirmed wired anywhere). If the second is genuinely dead code, low risk (fix: remove or wire); if something does consume it, it's a second source of truth for authorization that can drift from `ProtectedRoute`'s allow-lists — needs a definitive call-site check before Phase 4.
4. **Migration/deployed-DB drift risk.** No CI gate applies migrations; `db:check-migrations` is a hand-maintained marker list already caught stale once (missed 70+ migrations); `db:migrate` has no transaction wrapping/rollback/dry-run and is entirely developer-triggered. Two new migrations are currently untracked by the checker. Before trusting *any* schema-dependent Phase 1 finding, confirm the migration files actually match the live deployed DB (query the DB directly, don't just read migration files) — map-supabase's report explicitly flags migration history as "not fully linear/trustworthy as sole source of truth" (e.g. same-day table drops/recreates on 2026-08-04).
5. **Test suite gives false confidence.** 29 unit test files, zero touch Supabase (no mocks, no real calls) — they verify pure logic only. CI runs only 8 of 29 test files plus 4 static `quality:*` scripts (text-pattern scans for known-bad strings, not behavioral checks). No lint/build/typecheck/e2e/AI-benchmark gate in CI. Edge-function deploy workflow auto-deploys to prod on path match with **zero test gate**. Implication for this whole campaign: "tests pass" / "quality:scan green" must never be treated as evidence a Phase 1–6 fix is correct — real verification requires hitting the actual DB/RLS/edge functions, per the campaign's own rule #11/12.
6. **Client-side duplicate-of-server calculations**, all self-documented but real drift risk if the server formula changes without the client mirror being updated in lockstep: `src/lib/deterministicEngines.ts` (mastery/session-analytics mirror), `progressionMath.ts` (XP/level/league mirror, explicitly warns "prefer snapshot fields, especially league which has demotion hysteresis"), Decision Engine V2 weak-areas shim (`practiceService.ts:107-185`, feature-flagged off by default, reuses the `mastery_score` field name for a semantically different metric — do not flip that flag without downstream review).
7. **`mcp` edge function hardcodes an absolute Windows dev-machine path** (`npm:D:\Projects\schoolflow-connect\...`) — will not resolve in Supabase's deploy environment or any other machine. Confirm whether this function is meant to actually deploy; if so it's currently broken.
8. **`ExplainPanel.tsx` bypasses the service layer**, reading/writing `ai_explanations` directly via `(supabase as any)`, disabling type safety and skipping whatever the `academic/services` layer would otherwise enforce.
9. **Prior audit's still-open Medium items** (`docs/QUALITY_PRODUCTION_AUDIT.md` M1–M5, dated 2026-08-02/03, not re-verified today): client-derived Battle Rating not engine-stored, dual leaderboard paths (`rpc_leaderboard` vs `ProgressionService.leaderboard` — corroborates finding above), non-persisted 2FA/settings toggles, parent mark-% UI fallback, practice-duration ≥1-minute inflation. Also "Admin ops local CRUD remains non-production" per that audit's verdict table — needs a fresh check, it's 3 weeks stale.
10. **File-size/architecture hygiene** (low severity, not a correctness risk but flagged per CLAUDE.md's own 500-line rule): `practiceService.ts` (1521 lines), `aiRouter.ts` (~4200 lines), `battleExperienceService.ts` (949 lines), `PrincipalApp.tsx` (~700 lines).

---

## 4. What Phase 0 did NOT cover (explicitly deferred, not silently skipped)

- Full line-by-line read of `aiRouter.ts`'s image-doubt-solve, question-paper-outline/marking-scheme, and concept-explain cases (routing/authz pattern confirmed consistent via the shared helpers; prompt-construction internals not verified line-by-line).
- `academic/services/context.ts`'s `assertCanOwn`/`assertCanConsume` — named as the real authorization backbone by two agents but not read in full by either.
- Live-database verification of anything — Phase 0 was static code/schema reading only, per the campaign's own instruction not to start Phase 1 work yet. Given finding #4 above, Phase 1 must start with confirming migration-file state against the actual live DB before trusting any schema claim in this document.
- Attendance/marks/homework/timetable calculation-level correctness (percentages, aggregation) — scoped for Phase 2, not touched yet.
- Full page-by-page data-to-UI correctness (Phase 3) and live RLS penetration testing (Phase 4) — not started.

---

## 5. Six-agent source reports

Full verbatim subsystem reports (frontend, Supabase/schema/RLS, academic business logic, AI/Nova, org/roles/auth, quality tooling) are preserved in this session's transcript. This document is the synthesized, reconciled version — treat it as authoritative over re-deriving from scratch in future sessions, but re-verify anything load-bearing against current code/DB before acting on it, per campaign rule that memory/audit records are a starting point, not a substitute for live verification.
