# Known Issues / Deferred Work

## Principal Dashboard (Sept 2026 spec) — open questions and follow-ups

Found while building the four-block Principal Dashboard
(`src/gurukul-principal/dashboard/`). Written here, not fixed, per the build
rule.

**Open questions from the spec (need a ruling before further build):**

- **§9 — date range scope.** A single range control sits at the top of the
  dashboard and currently governs the range-dependent block only (Teacher
  activity). Attendance is always "today"; the switching slot is event-driven;
  fees is current-outstanding. Whether one control should drive fees/exams/
  teacher-activity together is unresolved.
- **§8 — does the principal see fees at all?** Assumed **yes** and built. The
  panel also honours `app_settings.enable_fees` (shows "turned off" when false).
  Confirm the assumption.
- **§9 — `rpc_principal_school_health`.** Measured against this spec: it is the
  wrong shape. It reads `attendance.date` directly (cannot tell an unmarked
  section from 0%), returns `attendance_today_pct = 0` when nothing is marked
  (spec forbids inferring unmarked), and its `declining/improving_classes` are
  hardcoded `[]`. The dashboard instead composes `AttendanceService`,
  `AnalyticsService`, `fees`, `exams`/`exam_subjects` and the finance/academic
  metric modules. Recommend leaving the RPC orphaned, not wiring it.

**Follow-ups (not done this pass):**

- **Fee drill-down depth.** Spec §8 wants school → class → section → student for
  fees. This pass ships the school + class-wise breakdown (real data); the
  section/student fee pages do not exist yet and class rows currently land on
  the existing `/principal/classes` list rather than a fee-scoped drill-down.
- **Needs-attention doors.** Each line shows a real count and links to the
  nearest existing route (attendance / classes / exams). Dedicated named-student
  list pages per door (unpaid-past-due list, unmarked-subjects list) are not
  built yet.
- **UUID-vs-className routing gap.** Pre-existing: dashboard blocks navigate to
  `/principal/classes/:classId` (UUID) while the routed page expects
  `:className`. Unchanged here; noted so fee/exam drill-downs do not inherit it.
- **Orphaned old dashboard blocks.** `PrincipalDashboardRedesigned.tsx` was
  removed (replaced entirely, per the spec). Its six blocks
  (`NeedsDecision`, `ClassWatchlist`, `BelowAttendanceThreshold`,
  `HomeworkBlock`, `AcademicsAhead`, `RecentUploads`) are now unreachable and
  are deletion candidates once confirmed unused elsewhere.


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
