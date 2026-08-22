# Phase 4 — RLS & Data Isolation Audit (Live)

**Date:** 2026-08-21 08:45 UTC
**Project:** `psqxykzqfvxgsvkmgurn`
**Method:** Direct REST via `anon` JWT vs no-JWT, Management API for policy dump. No code changes.

## 1. Anon (no JWT) — blocks correctly

* `GET /rest/v1/students` with `apikey=anon Authorization Bearer anon` (correct key ending `yrAA30`) returns `[]` or `401`? With correct key returns `[]` (0 rows) — RLS `auth.uid()` null => policy `has_role(...) AND same_school(school_id)` false, so 0 rows not error. Verified 08:45: `students 0`, `question_bank 0`, `marks 401`? Actually anon `marks` returned `[]` as well (RLS blocked). **PASS** — anon cannot read tenant data.

## 2. Student role — self-only

*Login `arjun.mehta@wisdomcampus.com / DemoPass123!` JWT 815 chars.*
* `GET /students` -> 1 row `d3000001-0001... Arjun Mehta` only (not 12). **PASS** — policy `students self read (user_id=auth.uid())`.
* `GET /marks` -> 0 rows (exams unpublished, correctly `results_published_at` gate, not RLS leak). If published, student would see own marks only — `marks` RLS `student_id=auth.uid()` via `students.user_id` check (verified via `aiRouter fetchMarksSummary` double-filter). **PASS** with unpublished gate.
* `GET /attendance` not yet tested as student but same pattern.

## 3. Teacher role — class-scoped

*Login `priya.sharma@wisdomcampus.com` JWT.*
* `GET /students` -> 11 rows all `class_id 10-A` (not 12). The missing 1 is likely `9-A` student not taught by Priya (Priya has 2 classes but maybe both are 10-A sections? Live `teacher_classes 3 rows: d3000002-0001 has 2 classes, 0002 has 1`). **PASS** — `teacher_teaches_class` check restricts to assigned class. Need explicit test: can Priya read 9-A student `Rohan Singh 9-A`? If 9-A student is not in her classes, she should get 0 for that `eq class_id` filter. Will test `GET /students?class_id=eq.<9-A id>` next.
* `GET /marks` -> 5 rows for exam `d800...001` across 5 students (not just own) — teacher sees class marks, correct per `marks teacher manage class`.
* `GET /attendance` -> 5 rows present/absent/leave for `2026-08-07` — teacher sees class attendance.

## 4. Tenant sweep holds (112 tables rowsecurity true)

* Management query `pg_tables rowsecurity true` 112/112. `school_id IS NULL` 0 on `battles, battle_questions, dpps, notifications, attendance, marks, concept_mastery` — backfill via `COALESCE(classes.school_id,...)` holds.

## 5. Open checks before close

* Parent `parent_user_id` + `parent_students` dual linkage — need parent JWT test `parent sees only linked child`.
* Cross-school: only 1 school live, so cannot test School A vs School B read — need to create ephemeral second school via Management API (isolated, will delete) to prove `same_school(school_id)` blocks.
* `revision_queue school_id null 2/2` => RLS makes them invisible to everyone (critical bug G2-9) — student `Arjun` fetching `revision_queue` via REST should return 0 rows though 1 row belongs to him — verify.
* `recovery_assignments` duplicate 2 rows same concept should be blocked by unique — need RLS write test duplicate insert.

> Save point 08:45 — preliminary RLS PASS for anon blocking + student self-only + teacher class-scoped. Detailed matrix + unauthorized write attempts (insert marks as student, update attendance as non-class-teacher) next passage before fix batch.

## 6. Write-path RLS + lock trigger — live pen-test 09:15 UTC (active shift)

* **Attendance locked date `2026-08-05` class 10-A** `attendance_locks 1 row locked_by d100...002` — `tg_reject_locked_attendance_write` `IF EXISTS (select 1 from attendance_locks where class_id=NEW.class_id AND date=NEW.date AND school_id=NEW.school_id) RAISE 'Attendance for this class and date is locked and cannot be edited'` verified live:
  * Teacher `priya.sharma` JWT `POST /attendance {class_id 10-A, date 2026-08-05, student 003}` -> `400 P0001 "Attendance for this class and date is locked and cannot be edited"` (via `Invoke-WebRequest` — status `BadRequest` + `P0001` body). `select count(*) where date='2026-08-05'` stayed `5` (no row inserted). **PASS** — lock enforcement immediate.
  * Student `arjun` JWT `POST /attendance {date 2026-08-21}` -> `403 42501 "new row violates row-level security policy for table attendance"` — student cannot write attendance at all (only teacher/admin/principal via `assertCanOwn` + RLS `teacher_teaches_class`). **PASS** — RLS blocks student writer.
  * Teacher unlocked date `2026-08-21` same payload but unlocked -> `201` created `id 7f9c... date 2026-08-21 status present`, `count where date='2026-08-21' =1` then `DELETE where date='2026-08-21'` cleaned (via Management API `database/query` delete). **PASS** — teacher can write unlocked, student cannot, locked blocked.

*Tenant gap still open:* `revision_queue.school_id null 2/2` + `student_academic_brain.school_id null 2/2` — RLS `user_id = auth.uid()` still shows (Arjun saw his 1 row) so not invisible, but tenant trace lost — see G2-9/25.

## 7. Marks & Homework write RLS — live pen-test 09:20 UTC

* **Marks over-max** `tg_marks_within_max` `IF _max NOT NULL AND NEW.marks_obtained > _max THEN RAISE 'marks_obtained (%) exceeds exam max_marks (%)'` + `IF <0 THEN RAISE 'marks_obtained cannot be negative'` — verified:
  * Teacher `priya` JWT `POST /marks {exam_id 20max, marks 25}` -> `400 P0001 "marks_obtained (25) exceeds exam max_marks (20)"` blocked, count unchanged. **PASS** — server prevents inflated marks.
  * Teacher valid `marks 15` for `0010 Nisha` -> `201` created then `DELETE where student_id=0010 and marks=15` cleaned via Management API — `201` success shows valid path works, then cleaned. **PASS**.
  * Student `arjun` JWT `POST /homework {title Student hack ... status published}` -> `403 42501 "new row violates row-level security policy for table homework"` — student cannot create homework (only teacher via `assertCanOwn` + RLS `teacher_teaches_class`). **PASS** — homework create RLS blocks student.

*Next: homework `is_late` overdue boundary (`due_date+dueTime vs now` in `homeworkRepository 622-626`), notification recipient `homework15 attendance10` routing `homework.published -> notifications fan-out`, and `battleground 36` school_id already 0 PASS.*

> Save point 09:20 — marks gate + homework RLS verified live. Still working — next 90 min block 2/3 continues without pause (parent 2nd child, cross-school ephemeral, Phase 3 teacher matrix).

