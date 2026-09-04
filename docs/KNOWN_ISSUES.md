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

---

## Handoff — 4 Sep 2026: three rulings applied, two gates still red

### `parent_academic_alerts` was DROPPED, deliberately

`20260904230000_drop_parent_academic_alerts.sql`, with a rollback that
recreates the table, both policies and all three foreign keys.

**Reason, recorded so this cannot later read as an accident.** The table held
0 rows, had no writer, no trigger, no reader, no inbound foreign key and no
database function referencing it. Its only remaining references were its own
two RLS policies. It belonged to the AI parent-academic-alerts feature, which
was ruled not to exist because every generation rule it had was derived from
practice data (§10.15: "School data only. No practice data."). An empty table
that looks designed is a trap: the next session finds it and writes an emitter.

The measurement also turned up that the table was **writable** by any signed-in
user — `has_table_privilege('authenticated', …, 'INSERT')` was true, held
through a PUBLIC grant rather than a named-role grant, which is why it did not
appear in `information_schema.role_table_grants` and survived the Chunk 9.5
sweep. Its permissive policy constrained only `parent_user_id`, not
`student_id`, and `school_id` was nullable so the RESTRICTIVE fence admitted a
NULL. Nothing read the table, so this was storage rather than disclosure — but
it is why the drop is better than leaving it dormant.

If a school-data emitter is built later it gets a table shaped for its own
requirements. It must not inherit this one: the `kind` CHECK enumerates the
four *practice*-derived alert kinds.

**Rollback ordering:** `rollback/20260904190000_parent_digest_delivery.rollback.sql`
SELECTs from this table. To roll back 190000, run 230000's rollback first.

### `lint:baseline` was blind in every worktree — a worked example of rule 10a

The one gate specifically designed to refuse to be green when it lints nothing
was refusing to run at all, everywhere the work actually happens.

A git worktree gets its own empty `node_modules` (here it contained only
`.vite`). `vitest` and `tsc` resolve by walking up the directory tree and found
the primary checkout's `node_modules`, so they ran fine and looked like
evidence that the environment was healthy. `eslint` resolves its config and
plugins relative to the working directory, so it failed to resolve at all — and
the failure surfaced as the gate not running, not as a red gate.

The shape to remember: **a gate that cannot run is more dangerous than a gate
that fails**, because the harness reports the same "nothing wrong here" either
way. Any gate whose tool resolves relative to cwd needs to prove it actually
inspected something before reporting green.

### Ten zero-byte junk files: how they got there

Files named `$n`, `'score'`, `-`, `166`, `2)` and similar appeared at the repo
root. They are heredoc debris: shell heredocs containing SQL — `$function$`,
`$$`, `$1`, backticks, unbalanced parens — were partially interpreted by the
shell, which created empty files from the fragments. `git add -A` then swept
them into the index.

**Avoid by** writing SQL and TypeScript with the file-writing tool rather than
shell heredocs, and by never using `git add -A` in this repo — stage named
paths. Both were done for the 4 Sep migrations and no junk files were produced.

### Lint debt: 143 errors, one mechanical pass

`npm run lint:baseline` passes (143 errors / 82 warnings, unchanged, across 660
files). **133 of the 143 are `@typescript-eslint/no-explicit-any`** — a single
mechanical follow-up pass, not 143 separate decisions. The remaining 10 are
worth reading individually.

Note the gate's own stated bound: it proves the TOTALS did not grow, not that
no new violation was added. One fixed and one added reads as unchanged.

### Two `db:verify-integrity` checks are RED, both pre-existing, both need a ruling

Neither is caused by the 4 Sep work — the three migrations touched only
`_parent_weekly_digest`, `test_attempts_test_id_fkey` and
`parent_academic_alerts`.

1. **`attendance_locks` still exists** — the table plus three policies
   (`locks admin delete`, `locks read auth`, `locks teacher insert`).
   `docs/locked-decisions.md:76` and `docs/foundation-build-prompt.md:1312` both
   say it must not exist anywhere: no table, no view, no policy, no function.
   Removing it is a destructive drop and has not been ruled on.

2. **`attendance_day_edits` is a view that is not `security_invoker`** — so it
   runs with the owner's RLS rather than the caller's. This is the same defect
   class as the two `security_invoker` traps found in Chunk 9, one of which let
   an admin of school A restore a school B row. It should be assumed exploitable
   until proven otherwise.

A third check — "rpc_parent_child_snapshot/rpc_parent_weekly_digest also check
the parent_students join table" — was ALSO red and has been FIXED, because it
was red for a false reason. 20260904190000 split the digest into a thin auth
wrapper plus `_parent_weekly_digest`, and the check read only the entry point's
`prosrc`. The property was fully satisfied one call down. The check now follows
delegation, and was proven still to have teeth against a function that
genuinely lacks the join.
