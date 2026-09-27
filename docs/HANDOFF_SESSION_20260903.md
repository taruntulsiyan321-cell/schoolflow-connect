# Session Handoff: 2026-09-03

## Completed Work

### 1. TypeScript Missing Emitters Added
Added `emitEventBestEffort` to complete the event catalog per §10.15:
- **`remark.created`**: `src/academic/services/remarksService.ts` (`RemarksService.create`)
- **`homework.graded`**: `src/academic/services/homeworkService.ts` (`HomeworkService.grade`)
- **`homework.reviewed`/`returned`/`graded`**: `src/academic/services/homeworkService.ts` (`HomeworkService.review`)
- **`homework.submitted`/`resubmitted`**: `src/academic/services/homeworkService.ts` (`HomeworkService.submit`)

*Note: Research confirmed that `marks.results_published`, `test.attempt.completed`, and `examination.scheduled` were already correctly implemented.*

### 2. SQL Fixes Written (Awaiting Migration) — SUPERSEDED, files removed 2026-09-27
Two drafts were written here and never applied, and a third (`20260903140000_rename_admission_enquiries`) sat
beside them. **Do not recreate or apply them.** Measured on production 2026-09-27, later work did each one:

1. `20260903120000_fix_weekly_digest_violations` — the digest was rebuilt school-only
   (`rpc_parent_weekly_digest` → `_parent_weekly_digest`); neither the `'improvement'` branch (§10.8) nor
   `exam_readiness` (§10.15) is in it. Applying the draft would have put the older body back.
2. `20260903130000_audit_logs_admin_only` — `audit_logs` was dropped by `20260904100000_audit_consolidation`;
   its replacement `academic_audit` is already readable by an admin only. The draft would have failed.
3. `20260903140000_rename_admission_enquiries` — the rename was applied as `20260903100000_admission_enquiries_rename`.
   The draft would have failed.

---

## Action Items for You (The Developer)

None left from this handoff: the migrations it listed are superseded (above), and `npm run db:check-migrations`
reports nothing pending.

## Items Still Blocked on Decisions

The following items from the original handoff were untouched and await your rulings:
- **Chunk 9**: Whether `trash` table gets created vs. soft delete via `deleted_at`/`deleted_by` columns + `students_current` view.
- **Seven threshold families** — three still unsent.
- **`Recovery.tsx`'s blended pass** — needs per-tier data plumbed into `SessionResults`.
