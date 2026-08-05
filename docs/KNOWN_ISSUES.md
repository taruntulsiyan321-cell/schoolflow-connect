# Known Issues / Deferred Work

## `rpc_academic_revision_plan` is missing, and should stay missing until Slice 2

**Status:** Confirmed unused. Not fixed. Do not recreate from migration history without re-checking this first.

`rpc_academic_revision_plan` is referenced by `fetchRevisionPlan()` in
`src/lib/academicBrain.ts:104`, and calling it 404s (`PGRST202` — function
was never actually applied live, despite existing in old migration history).

Traced every real call path to `fetchRevisionPlan()` and confirmed both are
dead code, unreachable from the live app:

1. `src/pages/student/RevisionQueue.tsx:66` calls it directly. This page is
   never routed — not in `src/App.tsx`, not in
   `src/pages/StudentDashboard.tsx`'s route list, not rendered as JSX by any
   component in `src/`. `src/gurukul/pages/Recovery.tsx:407` even labels a
   deep-link comment "legacy RevisionQueue," confirming this is a known-dead
   holdover from the pre-Gurukul rewrite.

2. `src/lib/academicAgents.ts:188` calls it inside
   `runAcademicIntelligencePipeline()`, which is called only by
   `src/hooks/useAcademicCoach.ts`, which is called only by
   `src/components/student/analytics/AnalyticsStudio.tsx`, which is rendered
   only by `AcademicAnalyticsDashboard.tsx`, which is rendered only by
   `src/pages/student/AcademicAnalytics.tsx` (a page). That page is never
   imported or routed anywhere in `src/` — the live `analysis` route
   (`src/pages/StudentDashboard.tsx:269`) points to
   `src/gurukul/pages/Analysis.tsx` instead, which does not reference
   `academicBrain`, `academicAgents`, `useAcademicCoach`, or `AnalyticsStudio`
   at all.

Both paths are `src/pages/student/*`-tree legacy pages superseded by the live
`src/gurukul/pages/*` tree. Neither is reachable by any user, so this 404
never fires in production.

**Decision:** Do not recreate `rpc_academic_revision_plan`. Recreating it
would resurrect unused infrastructure for a dead code path, not fix a real
defect. The actual replacement — a Revision Policy built on the four-layer
Signal/Decision Engine — belongs in Slice 2
(`docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md`), reading from the same
Learning Dimensions Slice 1 already established, not a resurrection of the
old ad hoc RPC.

If `RevisionQueue.tsx` or `AcademicAnalytics.tsx` are ever wired back into a
route, re-run this trace before assuming this conclusion still holds.
