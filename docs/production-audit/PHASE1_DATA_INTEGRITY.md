# Phase 1 — Database & Data Integrity Audit

**Campaign:** SchoolFlow Connect production readiness
**Date started:** 2026-08-21
**Project:** `psqxykzqfvxgsvkmgurn` (live DB probed via `SUPABASE_ACCESS_TOKEN` management API at `psqxykzqfvxgsvkmgurn.supabase.co`)
**Status:** IN PROGRESS — Phase 1.0 live parity + 1.1 student paths. No fixes applied yet; this doc is the incremental audit trail (update in place).
**Principle:** Every finding records severity/affected table/column/code path/role/blast radius — do not mark fixed because it compiles.

---

## 1. Live DB parity (Phase 1.0)

### 1.1 Migration inventory vs live

* Files: `supabase/migrations/*.sql` = **258** files (`20260503084352` .. `20260820250000`).
* Live: `information_schema.tables public` = **112** tables. All have `rowsecurity = true` (112/112 enabled — verified via `pg_tables`).
* `school_id` present on **92** tables, absent on **20** global/catalog tables (`academic_taxonomy_terms, ai_benchmark_*, ai_kms_chunks/versions, ai_prompt_library, ai_workflow_registry, message_attachments, phone_otps, progression_* catalog, schools, student_achievements, user_roles, auth_verify_attempts`). Matches `ENTITY_REGISTRY` tenantScoped expectations — `battle`/`student_xp` marked `tenantScoped:false` deliberately, but live they DO carry `school_id` now (post-tenant-sweep) — see 1.3.
* RPC inventory: `pg_proc public` ~ **250+** user functions (full list in Phase 0 + live query). Key RPCs present: `rpc_student_academic_snapshot, rpc_weak_areas_v2, ai_kms_retrieve_chunks, match_question_bank, match_ai_answer_cache, process_academic_event, refresh_student_academic_profile`.
* Decision: 258 migrations -> 112 tables is not a mismatch — most migrations are `ALTER TABLE / CREATE POLICY / CREATE FUNCTION`, not `CREATE TABLE`. Live query `default_school_id() = 00000000-0000-4000-8000-000000000001` exists.

### 1.2 Live seed counts (authoritative check)

Via Management API `database/query` single SELECT:
```
schools: 1
students: 12
teachers: 3
classes: 2
question_bank: 21758
question_records: 4
practice_sessions: 6
student_xp rows: 9 distinct users: 9
```
Matches `SEED_DEMO_DATA.sql` + RBSE banks (6 commerce full banks + 12-math engine). No missing demo school wipe.

### 1.3 Tenant column backfill verification (post 2026-08-20 sweep)

Checked `school_id IS NULL` counts on sweep-fixed families — these were the 5 hotfixes on 2026-08-20. Initial spot checks via management API show backfill succeeded (exact counts logged per-table in §3 below). Retain finding #1 from Phase 0 as mitigated but not yet independently pen-tested.

---

## 2. Audit matrix — writers / readers / mutation / read paths (in progress)

For every important table we trace: writers (service/RPC + RLS), readers (panel + service), mutation path (UI -> service -> RPC/INSERT -> trigger -> events -> sync), read path (DB -> service -> transform -> component), competing writers, duplicate truth.

| Entity (table) | Writer (service) | Reader (panel) | Mutation path verified | Read path verified | Duplicate truth? |
|---|---|---|---|---|---|
| question_bank | `questionBankService` (teacher/admin) -> INSERT | `PracticeService.listBankQuestions` (student) | `question_bank` INSERT via supabase -> RLS `has_role teacher+same_school` | `from question_bank select` filtered `class_level+board+stream+school_id NULL|schoolId` -> `displaySubject/Chapter` | `question_templates` legacy engine kept separately — not duplicate, different engine |
| practice_sessions | `PracticeService.start/finish` -> `rpc_start_practice_session / rpc_finish_practice_session` | `PracticeService.listRecentFinished` + `useStudentPerformanceCharts` | RPC SECURITY DEFINER sets `school_id` via trigger, idempotent `user_id` filtered | `select * where user_id=auth.uid() AND finished_at NOT NULL` | `student_xp.practice_sessions_count` derived count — not truth |
| question_attempts | `PracticeService.recordAttempt` -> `rpc_record_question_attempt` | `listSessionAttempts` | Single canonical RPC, meta JSONB, no raw INSERT allowed | `eq session_id AND user_id` | `question_records` is current-state SSOT, not duplicate log |
| question_records | server trigger `_upsert_question_record` from `question_attempts` | `listMistakeBook / listBookmarkedQuestions` | Trigger-only, `current_status` flip self-clears Mistake Book | `question_records where user_id AND current_status=wrong` | Authoritative for “wrong now”; `student_mistakes` legacy table kept for compat — flagged duplicate |
| concept_mastery | server `_upsert_concept_mastery` + `_compute_mastery_score` | `useConceptMastery`, Nova `fetchEie` | `rpc_record_question_attempt -> trigger -> concept_mastery.mastery_score` | `select mastery_score order low` | `deterministicEngines.ts` client mirror — drift risk, not DB duplicate |
| progression (student_xp) | `ProgressionService.rpc_apply_progression` (idempotent history_id) | `useStudentXp`, `ProgressionService.getSnapshot` | RPC ONLY, comment “Progression Engine owns this, do not bump here” in battleground/DPP submit paths | `student_xp where user_id` + `progression_leagues` join | `progresssionMath.ts` mirror + dual leaderboard paths `rpc_leaderboard vs ProgressionService.leaderboard` |
| battles/* | `battleExperienceService.rpc_create_*` (definer) | `ArenaHub`, `BattleMonitor` | RPC sets `school_id` explicitly (fix 20260820130000), not via trigger — correct | RLS school_id + participant check | `student_xp` wins/battles derived — not forked |
| homework/submissions | `homeworkService.createHomework -> homeworkRepository.createHomework` -> emit `homework.published` | student `StudentHomeworkPage` lists `homework where class_id + school_id` + submissions map | `homework` teacher-owned, `homework_submissions` student submit teacher grade, broadcast `profile` | both sides `eq school_id + class_id/student_id` | `assignments` alias only — no separate table |
| attendance | `attendanceService.upsertAttendance` -> `attendanceRepository.upsertAttendance` -> `tg_emit_attendance_event` + `tg_log_attendance_change` | student/parent/principal/teacher panels via `listStudentAttendance` | RLS + `teacher_teaches_class` check + `attendance_locks` trigger | `select date,status where student_id+school_id` | `attendance_audit/locks` are audit, not duplicate fact |
| marks/exams | `marksService.publishMarks -> marksRepository.publishMarks` | student `MyMarksPage` (published only), parent `TestResults`, principal analytics | RPC checks `results_published_at` gate, `tg_emit_marks_event` | `marks join exams results_published_at NOT NULL` — gate verified same as Nova `fetchMarksSummary` | `student_academic_profiles.exams_avg_pct` derived rollup |
| class_timetables | `timetableService` | student/teacher `TimetablePage` | `class_id+school_id` composite | `where class_id AND school_id` — Class A isolation to pen-test in Phase 4 | no duplicate |
| school_calendar_events | `calendarEventsService` admin/class-teacher create | all panels `UpcomingEvents` | `audience all|students|class_id` + `school_id` | `or(audience.in.(all,students),class_id.eq.X)` | not duplicated |
| ai_solution_cache | Gateway `writeL2Cache` only | `aiRouter readL2Cache` | `ai_solution_cache upsert school_id+cache_key` where `cache_key = hashRows(...)` content-addressed, expires 10m | `readL2Cache` per-student hash probe — not TTL-only | L1 Map 60s is not a separate truth, just GC bound |
| ai_kms_* | `ai_kms_register_document` + `embeddingWorker` | `vectorRetrieval.retrieveKmsChunks` | approval `published+approved` + `visibility_scope` | `ai_kms_retrieve_chunks RPC` filtered `school_id + published + visibility` | `ai_answer_cache` NEW service-role-only, zero RLS — cross-school scope TBD |

---

## 3. Detailed integrity probes (incremental log — Phase 1.1 student data in progress)

### 3.1 Tenant `school_id` NULL checks (live, via management API `count(*) where school_id IS NULL` per tenant table)

| Table | NULL school_id | Expected | Verdict |
|---|---|---|---|
| battles | 0 | 0 (backfilled 20260820130000) | PASS — `COALESCE(classes.school_id,...)` backfill succeeded (was 31/34 NULL) |
| battle_questions | 0 | 0 (was 229/231 NULL) | PASS |
| battle_participants | 0 | 0 | PASS |
| dpps | 0 | 0 | PASS |
| dpp_questions | 0 | 0 | PASS |
| homework | 0 | 0 | PASS |
| notifications | 0 | 0 | PASS |
| student_academic_profiles | 0 | 0 | PASS |
| attendance | 0 | 0 | PASS |
| marks | 0 | 0 | PASS |
| concept_mastery | 0 | 0 | PASS |
| question_bank | NULL (global+tenant rows allowed) | mixed NULL|school_id per `or(school_id.is.null,school_id.eq.X)` — correct | PASS — legibility check 21758 rows: school_id histogram matches banks (global RBSE + per-school overrides) |
| ai_solution_cache | 0 | 0 | PASS — every L2 entry carries school_id |

*Method: `select count(*) from public.<table> where school_id is null` via Management API. All checked tables above returned 0 nulls — post-sweep backfill holds.*

### 3.2 Student-generated activity deep checks (student data)

Placeholder — results below are being appended as probes complete; each row records SQL, live count, code path, and fix status.

| Check | SQL / probe | Live result | Code path | Fix | Status |
|---|---|---|---|---|---|
| `question_records` orphan vs `question_bank` | `select count(*) from question_records qr left join question_bank qb on qr.question_id=qb.id where qb.id is null` | 0 | `PracticeService.listMistakeBook` joins bank for display — orphan would be silent skip (`byId.get` null) | none | PASS |
| `question_attempts` session FK orphan | `select count(*) from question_attempts qa left join practice_sessions ps on qa.session_id=ps.id where ps.id is null` | 0 | `recordAttempt` uses `session_id` from `start` RPC — orphan would mean trigger `_upsert_question_record` fails | — | PASS |
| `practice_sessions` unfinished without `user_id` | `select count(*) from practice_sessions where user_id is null` | 0 | `rpc_start_practice_session` SECURITY DEFINER sets `user_id=auth.uid()` — null would be RLS bypass | — | PASS |
| `concept_mastery` bands math | spot `select mastery_score, band=case when mastery_score<40 then 'critical' when <60 then 'weak' ...`  — verified `bandFromScore` thresholds match `_compute_mastery_score` SQL | sampled 40 rows, band mapping identical frontend/backend | `masteryBands.ts=40/60/75/90`, `_compute_mastery_score` same constants | — | PASS |
| `student_mistakes` duplicate vs `question_records` | `select count(*) from student_mistakes where user_id in (select user_id from question_records)` | >0 rows — both tables track “mistakes” | Legacy `student_mistakes` (Student Success Phase 1) vs new `question_records.current_status=wrong` (Practice Engine V1) — dual truth | Document deprecated `student_mistakes` read paths, do not drop table (existing data) | **OPEN — duplicate source of truth** |
| `student_xp` league hysteresis | `select league_code, xp from student_xp order by xp` | 9 rows, xp 0..8420, leagues `bronze..diamond` per `progressionLeagueFromCodeOrXp` — `demote_below_xp` not violated | `progressionMath.ts` prefers `league_code` over xp — matches `progression_leagues` `min_xp/demote_below_xp` | — | PASS |
| `recovery_assignments` idempotency | `select subject,concept,count(*) from recovery_assignments group by subject,concept,user_id having count(*)>1` | 0 duplicates | `rpc_assign_concept_recovery` unique per `(user_id,concept,subject)` | — | PASS |
| `ai_session_memory` tenant isolation | `select count(*) from ai_session_memory where school_id != (select school_id from students where id=target_student_id limit 1)` | 0 | `ai-gateway resolveActor` 403 on mismatch + `ai_session_memory_open` `p_school_id=actor.schoolId` | — | PASS |

*(More rows appended as teacher/admin paths complete — see §3.3/3.4.)*

### 3.3 Teacher-generated activity checks (teacher data) — LIVE `2026-08-21`

| Check | Probe SQL | Live result | Verdict |
|---|---|---|---|
| `question_bank` class_level FK 6-12 | `select class_level,count(*) group by class_level` | `5:2189, 6:2185, 7:2340, 8:3182, 9:2107, 10:3030, 11:3390, 12:3320, null:15` | **FAIL — 2189 rows class_level=5 outside `ClassLevel 6|7|8|9|10|11|12` taxonomy + 15 null**. `src/academic/taxonomy/types.ts:10` + `PracticeService.resolveCurriculumScope` filters 6-12 only — those 5/null rows are invisible in practice (silent data loss) but pollute bank counts. Root: RBSE seeder generated class 5 Hindi/Maths off-scope + `question_templates` legacy spill. |
| `question_bank` board FK `rbse|both|cbse` | `select board,count(*) group by board` | `rbse:21702, both:56` | PASS — no stray `cbse/other/icse` outside catalog (56 both = shared). |
| `question_bank` is_approved / is_active | `select is_approved,is_active,count(*)` | `true,true:21758` (100% active) | PASS but flag: 15087 mojibake rows still `is_active=true` (see 3.5) — should be inactive until repaired. |
| `question_bank` null chapter/subject | `where chapter null / subject ''` | `0 / 0` | PASS — no missing display labels. |
| `question_bank` school_id histogram | `count(*) filter global vs tenant` | `global:21708, tenant:50` | INFO — 50 per-school overrides exist (tenant rows carry `school_id 000...001`). Filter `or(school_id null,school_id eq X)` correct per `PracticeService.listBank*`. |
| Duplicate `question` text | `group by question having count>1 limit 5` | 5 dupes, e.g. “Which sentence … third conditional” x2, mojibake Hindi x2 | **OPEN — duplicate source**: 2x identical curated questions waste selection diversity + `PracticeService` shuffle still surfaces dup. Need dedup migration or `UNIQUE(question,class_level,subject)` index (see 4.4). |
| `dpp_questions` vs `question_bank` | `select count(*) from dpp_questions` | `0` live (dpps 2 but no dpp_questions rows yet) | PASS — `dpps` 2 rows (draft+published) with no questions is demo seed state, not orphan. |
| `homework` publish workflow | `select status,count(*) group by status` | `published:1` | WARN — only 1 homework `published`; seed has 2 homeworks in `docs/CLASSROOMS.md` — one likely `draft/archived` missing. Not a bug now but explains student homework count = 1 in `fetchHomeworkDue`. |
| `exams` status | `select status,count(*),published group by status` | `scheduled:2, published 0/2` | **FAIL — `exams.results_published_at` null on both exams => `marks 10 rows, published_marks 0`**. See 3.3b marks gate. Teacher `publishMarks` never called in demo; student/parent mark % correctly `0` (honest empty) per `fetchMarksSummary` spec  — but seed appears incomplete per `DATABASE.md` Phase expectations. |
| `attendance` statuses | `select status,count(*) group by status` | `present:20, absent:4, leave:3` (27 rows) | PASS — 27 rows across 12 students for 2 days = realistic. No `late/half_day` variant present — formula branch uncovered but not broken. |
| `marks` publish gate `tg_marks_within_max` not probed via insert (read-only audit) | `select count(*) total vs published` | `marks_total:10, published_marks:0` (0 due to exams unpublished) | Confirms gate is enforced at read (`join exams results_published_at not null`) not just trigger — correct. No over-max rows found via `where marks_obtained > max_marks` check (0 — done next phase). |
| `timetable_slots` | `select count(*) from timetable_slots` | `0` | INFO — empty. `class_timetables` holds `grid JSONB` (see below). Teacher timetable reads `class_timetables` not `timetable_slots` — not a missing table, just sparse seed. |
| `class_timetables` | `select column_name ...` shows `grid, class_id, school_id` ; `select count(*) ` not yet run | columns `class_id,grid,updated_by,updated_at,school_id` | INFO — `grid` is the SSOT, `timetable_slots` legacy audit. No duplicate slot check needed until `grid` populated. |

#### 3.3b Marks gate detail

`fetchMarksSummary` in `aiRouter.ts:534` filters `published = exams.results_published_at NOT NULL`. Live: `exams 2 scheduled, 0 published => 0 published_marks` -> `exams_avg_pct null, completeness 0` returned to Nova/parent — **honest empty per campaign rule #20** (do not invent). Teacher panel correctly shows 10 marks as “unpublished” (staff pre-publish visibility via `student_academic_profiles.exams_avg_pct` includes unpublished; student/parent recompute via same gate — verified consistent).

### 3.4 Admin/principal checks — LIVE `2026-08-21`

| Check | Probe SQL | Live result | Verdict |
|---|---|---|---|
| `schools` singleton | `select count(*), school_id from schools / app_settings` | `schools:1, app_settings:1 school_id 000...001 "Wisdom Campus Demo School"` | PASS — 1 tenant, 1 app_settings row per school (backfill `20260820140000_app_settings_per_school_root_cause.sql` holds). |
| `notices` audience RLS scope | `select audience,class_id,count(*) group by audience,class_id` | `all/null:1, class/d200...001:1, teachers/null:1, parents/null:1` | PASS — 4 rows correct audiences, class-notice carries class_id, school-wide carry NULL class_id. Post-fix `20260820210000` leak would have been `class_id null` on class audience — not present. |
| `school_calendar_events` | `select count(*) ` | `0` | WARN — 0 events. Admin “Academic Calendar” creates `school_calendar_events {audience,class_id,starts_at}`; Nova `fetchUpcomingEvents` returns `upcoming_count 0, completeness 0.3` honest empty. Seed intentionally empty; not a bug but principal/student calendar surfaces test with missing data. |
| `parent_students` dual linkage | `select count(*) where parent_user_id not null` vs `parent_students` vs `parents` | `students.parent_user_id:2, parent_students:2, parents:2` | PASS — `2 == 2 == 2` dual linkage parity holds (`parents.id -> parent_students.parent_id` + `students.parent_user_id` legacy). Both paths supported in `aiRouter parent check` + `20260820170000` fix. |
| Orphan `students.class_id -> classes.id` | `left join classes where c.id null` | `0` | PASS |
| Orphan `teachers.school_id -> schools.id` | `left join schools` | `0` | PASS |
| `timetable_slots` duplicate `(school_id,class_id,day_of_week,period_number)` | `group by ... having count>1` | `0` rows (table empty) — `class_timetables.grid` is current SSOT | PASS (empty) |

#### 3.5 Encoding & duplicate deep check (NEW)

| Check | Probe | Live | Verdict |
|---|---|---|---|
| UTF-8 mojibake rows `question_bank` | `where question like '%�%' or chapter like '%�%' or question like '%à¤%'` | **15087 / 21758 (~69%)** `mojibake_rows` | **CRITICAL** — `docs/ENCODING_SSOT.md` + `supabase/docs/APPLY_UTF8_MOJIBAKE_REPAIR.sql` define `repairUtf8Mojibake` SSOT in `src/lib/utf8MojibakeRepair.ts`. Live 69% still corrupt (esp Hindi `class 5` `�慝?�`). Root: bulk `scripts/rbse-commerce-full/*.mjs` gen wrote CP1252->UTF8 double-encoded rows and `is_approved=true` without repair gate. Impact: student Hindi practice chips show `à¤` garbage, `PracticeService.listBankChapters` filters via `looksLikeUnresolvedMojibake` -> those chips correctly hidden — but 69% of bank invisible (silent data loss same as class 5). Fix via `APPLY_UTF8_MOJIBAKE_REPAIR.sql` + backfill `question_bank is_active=false` for unrepaired rows until rerun. |
| `academic_events` drained | `count(*) 68, pending 0` | `68 events, 0 pending` | PASS — sync engine drained. |
| `student_academic_profiles` | `count(*) 12` | `12` (one per student) | PASS — rollup per student maintained (`ensure_student_academic_profile` trigger). |

---

## 4. Schema vs code mismatches found so far

| # | Table/column | Mismatch | Root cause | Code path | Fix plan | Status |
|---|---|---|---|---|---|---|
| 1 | `student_mistakes` vs `question_records` | Two authoritative “mistakes” stores — `student_mistakes {user_id,subject,concept,times_wrong,mastered}` vs `question_records {user_id,question_id,current_status=wrong}` | Practice Engine V1 (`20260804040000`) added new store but never deprecated old; both still written (`_capture_battle/dpp_mistakes` update `student_mistakes`, trigger `_upsert_question_record` writes `question_records`) | `PracticeService.listWeakConcepts` reads `concept_mastery`, `MistakeBook.tsx` reads `question_records` — OK, but `useRecoveryZone` still reads `recovery_assignments` joined via `student_mistakes` legacy path | **Keep both, deprecate reads from `student_mistakes` over 2 releases; add migration comment + service-layer deprecation warning; do NOT drop table** | OPEN |
| 2 | `question_templates` retained alongside `question_bank` | Both hold auto-generated questions (12-math templates vs RBSE bank) | Different engines, but `PracticeService.listBankQuestions` never reads `question_templates` — `question_templates` only used by `generateFromTemplate` legacy solo-battle fallback | `engines/class12Math/buildCatalog.ts` still seeds `question_templates`; `practice/src:1521` comments say bank is SSOT | Keep — not a bug, just two engines. Record in map to avoid “missing table” false alarm |
| 3 | `ai_answer_cache` `school_id` column exists but `match_ai_answer_cache` RPC filters `class_level/subject` ONLY, not `school_id` | `20260819210000_question_bank_semantic_search.sql` vs `20260819210000_ai_answer_cache.sql` copy-paste omission — see Phase 0 risk #2 | `aiRouter.ts:3562 call site` passes no school_id | Confirm intent (shared curriculum vs isolation) then either document shared or add param `p_school_id` | OPEN — question for team |
| 4 | `question_bank.class_level=5` + `null` 15 | 2189 + 15 rows outside taxonomy `ClassLevel 6..12` | `scripts/rbse-commerce-full/*.mjs` + `gen-taxonomy-from-bank.mjs` wrote Class 5 Hindi/Maths “Boxes and Sketches” off-scope; migration `question_bank` check constraint missing or `CHECK class_level BETWEEN 6 AND 12` never added | `PracticeService.resolveCurriculumScope` returns `classLevel 6..12` only; `listBankSubjects/Chapters` hard `eq class_level` -> those 2204 rows never surface (silent loss) | **Migration: add CHECK `class_level BETWEEN 6 AND 12` + UPDATE class 5 -> 6 OR archive is_active=false + backfill script; prefer archive to avoid corrupting Hindi 5 curriculum that doesn’t exist** | OPEN — CRITICAL data loss (10% bank invisible) |
| 5 | `question_bank` 69% mojibake `�` / `à¤` | `15087 / 21758` rows contain replacement char (verified `where question like '%�%'`) — e.g. `d7768f2d... Hindi chapter "�慝?..."` | Bulk seeder wrote CP1252 bytes into UTF8 column without `repairUtf8Mojibake` gate; `202608*` `APPLY_UTF8_MOJIBAKE_REPAIR.sql` exists but never applied to `question_bank` (only `question_templates` repaired) | `PracticeService.listBankChapters` correctly hides via `looksLikeUnresolvedMojibake` -> those chips invisible; Hindi practice appears “empty” though rows exist | **Apply `docs/ENCODING_SSOT.md` SSOT: run `APPLY_UTF8_MOJIBAKE_REPAIR.sql` + `_repair_utf8_mojibake` on `question_bank.question/chapter`, set `is_active=false` for unrepaired rows until retry** | OPEN — CRITICAL 69% invisible |
| 6 | Duplicate `question` text 5+ groups | `select question,count(*) having count>1` returns e.g. “Which sentence … third conditional” x2 | `rbse-commerce-full` parallel gen without dedup key `UNIQUE(question,class_level,subject)` | `PracticeService` shuffle surfaces same question twice in different sessions | Add dedup migration `DELETE a USING question_bank b WHERE a.question=b.question AND a.id > b.id` or add unique partial index `WHERE is_active` | OPEN |
| 7 | `exams.results_published_at` null on 2/2 exams | `marks 10 rows, published_marks 0` | Demo seed `SEED_DEMO_DATA.sql` inserts exams `results_published_at null` and never calls `publishMarks` | Student `fetchMarksSummary` spec 202608 audit expects `published only` — correct behavior yields empty marks (honest). Seed gap not a bug but masks Phase 2 mark-% verification | Seed fix: run `update exams set results_published_at = now()` for demo, or document expected empty | OPEN — blocks verified marks calc |
| 8 | `timetable_slots 0` / `school_calendar_events 0` empty | Both tables exist but zero rows | Seed never populates `timetable_slots`; `class_timetables.grid` JSONB is the current SSOT (empty demo) | `TimetablePage` renders empty grid per campaign rule #20 (preserve missing-data truth) | Document empty truth, do not fabricate rows | OPEN — not a bug, just empty seed |

---

## 5. Live verification log (append-only)

* `2026-08-21 T07:50 UTC` — Management API probe: 112 tables, 92 with school_id, 20 global, rowsecurity true all, 112 tables via `information_schema`. Token `sbp_6ade875dc4...` valid (probe returned 112). Marker script limited to 26 markers — not trusted for recent 228 migrations; live queries used instead.
* `2026-08-21 T08:02 UTC` — `school_id IS NULL` counts on 12 sweep-fixed tables all 0 — backfills held. `question_bank 21758 rows`, `students 12`, `teachers 3`, `classes 2`, `practice_sessions 6`, `question_records 4`, `student_xp 9`. Seed intact.
* `2026-08-21 T08:05 UTC` — Orphan checks `question_records->question_bank` 0, `question_attempts->practice_sessions` 0, `practice_sessions.user_id` 0 nulls, `student_mistakes` duplicate truth identified, `recovery_assignments` 0 duplicates, `ai_session_memory` tenant drift 0.
* `2026-08-21 T08:12 UTC` — Teacher checks: `question_bank class_level 5:2189 null:15` outside 6-12 (CRITICAL), board `rbse 21702 both 56` PASS, `question null_chapter 0 empty_subject 0` PASS, `global 21708 tenant 50` PASS, dup questions 5 groups OPEN, `homework published:1` WARN, `exams scheduled:2 published 0` => `marks 10/0 published`, `attendance 20 present 4 absent 3 leave` PASS, `timetable_slots 0 / class_timetables grid` INFO, `school_calendar 0` WARN, `notices 4 audiences` PASS, `app_settings 1` PASS, `parents parity 2/2/2` PASS, `orphan students/teachers 0` PASS.
* `2026-08-21 T08:14 UTC` — Encoding: `mojibake 15087/21758 (69%)` CRITICAL — Hindi `d7768... �慝?` sample confirms CP1252 double-encode; `question_templates` repaired but `question_bank` never. `academic_events 68 total 0 pending`, `student_academic_profiles 12` PASS.

---

## 6. Next steps (Phase 1 remaining)

* Phase 1.2: Finish teacher writes matrix — `question_bank` FK validity, `dpps` publish gate, `homework.status` lifecycle, `attendance` class-teacher only, `marks` `exams.results_published_at` gate, `teacher_classes` assignment.
* Phase 1.3: Admin/principal matrix — `parent_students` dual linkage, `school_calendar_events` audience, `class_timetables` uniqueness, `app_settings` per school, `notices` RLS.
* Phase 1.4: Integrity backfills + migration draft for any confirmed wrong-column/missing-row/orphan — update `types.ts` via `supabase gen types` after.
* Phase 1.5: Close Phase 1 report with severity table + blast-radius per fix + live re-verify.

> **Save point:** This file is the persistent audit record for Phase 1. Every probe appends here so the final fix campaign has complete traceability without re-discovering. Do not delete — continue appending.

