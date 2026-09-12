# Session Handoff: 2026-09-03

## Completed Work

### 1. TypeScript Missing Emitters Added
Added `emitEventBestEffort` to complete the event catalog per §10.15:
- **`remark.created`**: `src/academic/services/remarksService.ts` (`RemarksService.create`)
- **`homework.graded`**: `src/academic/services/homeworkService.ts` (`HomeworkService.grade`)
- **`homework.reviewed`/`returned`/`graded`**: `src/academic/services/homeworkService.ts` (`HomeworkService.review`)
- **`homework.submitted`/`resubmitted`**: `src/academic/services/homeworkService.ts` (`HomeworkService.submit`)

*Note: Research confirmed that `marks.results_published`, `test.attempt.completed`, and `examination.scheduled` were already correctly implemented.*

### 2. SQL Fixes Written (Awaiting Migration)
The following SQL migration files have been written but **NOT** applied, because the environment lacked `SUPABASE_ACCESS_TOKEN`:

1. `supabase/migrations/20260903120000_fix_weekly_digest_violations.sql`
   - Replaces `rpc_parent_weekly_digest` to remove the `'improvement'` branch (which violated §10.8) and the `'weakness'` branch (which keyed on `exam_readiness`, a metric that blends practice accuracy and violates §10.15).
   - Preserves the join-table logic introduced in `20260822190000_phase5_parent_join_table_and_snapshot_lockdown.sql`.

2. `supabase/migrations/20260903130000_audit_logs_admin_only.sql`
   - Changes the `audit_logs` RLS policy to be admin-only (using `public.has_role(auth.uid(), 'admin'::public.app_role)`), removing principal read access per §10.18.

---

## Action Items for You (The Developer)

Since this session lacked DB credentials, you must run the migrations manually. From a shell that has `SUPABASE_ACCESS_TOKEN` and `DATABASE_URL` set:

```bash
# 1. Apply the new migrations
npm run preflight && npm run db:migrate && npm run db:check-migrations

# 2. Re-generate types (and verify empty diff as requested in the brief)
npm run db:types

# 3. Final preflight
npm run preflight
```

## Items Still Blocked on Decisions

The following items from the original handoff were untouched and await your rulings:
- **Chunk 9**: Whether `trash` table gets created vs. soft delete via `deleted_at`/`deleted_by` columns + `students_current` view.
- **Seven threshold families** — three still unsent.
- **`Recovery.tsx`'s blended pass** — needs per-tier data plumbed into `SessionResults`.
