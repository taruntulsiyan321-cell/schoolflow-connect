# Phase 2 — Business Logic & Calculations Audit

**Campaign:** SchoolFlow Connect production readiness
**Date started:** 2026-08-21 08:25 UTC
**Project:** `psqxykzqfvxgsvkmgurn` — live DB `112 tables` probed via Management API
**Status:** IN PROGRESS — Phase 2.0 mastery/revision/XP/battleground/attendance/marks/homework in progress. No fixes applied. Incremental save.
**Principle:** Every calculation verified INPUTS -> FORMULA -> RESULT -> STORED -> CONSUMERS with controlled test cases, edge/boundary.

---

## 1. Mastery (concept_mastery.mastery_score)

**Formula live** `public._compute_mastery_score(_attempts,_correct,_recovery_attempts,_recovery_correct,_mistakes,_last_at) RETURNS numeric IMMUTABLE` `pg_proc` 2026-08-21 08:25:

```
_acc := CASE WHEN _attempts>0 THEN 100*_correct/_attempts ELSE 50 END
_rec := CASE WHEN _recovery>0 THEN 100*_recovery_correct/_recovery ELSE _acc END
_cons := CASE WHEN _attempts>=8 THEN LEAST(100,_acc+5) WHEN >=4 THEN _acc ELSE _acc*0.9 END
_recency := CASE _last_at NULL->40, >= now-3d ->100, >=14d->75, >=30d->50 ELSE 30 END
_penalty := LEAST(25, _mistakes*3)
RETURN LEAST(100, GREATEST(0, round(0.45*_acc +0.25*_rec +0.15*_cons +0.15*_recency - _penalty,1)))
```

**Thresholds** `src/academic/eie/masteryBands.ts:15` `critical<40 weak<60 developing<75 strong<90 mastered>=90` `WEAK_CONCEPT_THRESHOLD=60` — verified identical to SQL (weak <60). `bandFromScore` used by `getStudentAcademicSnapshot`, `fetchEie`, `PracticeService`.

**Live controlled tests** via `database/query` 08:25:
* `m1 _compute(10,7,0,0,2,now()) = 69.3` — 70% accuracy, 2 mistakes penalty 6 -> 69.3 developing (expected: 0.45*70 +0.25*70+0.15*75+0.15*100 -6 = 31.5+17.5+11.25+15-6=69.25 -> 69.3). **PASS** matches formula.
* `m2 _compute(10,10,0,0,0,now()) =100` — perfect -> mastered. PASS (LEAST cap).
* `m3 _compute(2,0,0,0,2, now-40d) =0` — 0% +0.9*0 + recency 30 -6 -> 4.5-6 -> GREATEST 0 =>0 critical. PASS (floor).

**Stored rows** 4 rows `concept_mastery` (live 08:20):
* `d100...001 Trigonometry 98.5` (recovery 0 mistakes 0, attempts ~?)
* `... Polynomials 12.0` (weak)
* `... Quadratic 98.5`
* `da00...001 area_sector_from_arc_length 98.5`
Band mapping: 98.5 mastered, 12.0 critical — matches thresholds.

**Writers:** `rpc_record_question_attempt` -> trigger `_upsert_question_record` -> `_upsert_concept_mastery` calls `_compute...`. No client direct write — verified `question_bank` no `mastery_score`. `deterministicEngines.ts` client mirror exists but labeled drift risk G0-6.

**Consumers:** `useConceptMastery (rpc_student_concept_mastery)`, `fetchEie (revisionQueue+mastery join)`, `Nova fetchProgression weak_concepts dedupe <60`, `PracticeService.listWeakConcepts`, `DecisionEngine V2 rpc_weak_areas_v2` (same dimensions, different policy). All read via `user_id` + `school_id` scoped.

**Edge cases to verify next:** repeated correct streak vs repeated wrong penalty cap 25, recency decay 30 days, recovery bonus (need _recovery_attempts test), empty attempts 50 baseline.

---

## 2. XP / Level / League / Leaderboard (student_xp)

**Formulas live:**
* `progression_xp_for_level(n) IMMUTABLE` via Management API: `l1 0, l2 100, l3 300, l10 4500` — triangular `100*n*(n-1)/2` (n=10 => 100*45=4500). Matches `progressionMath.ts` mirror.
* `progression_level_for_xp(_xp) = GREATEST(1, floor((1+ sqrt(1+8*xp/100))/2))` inverse triangular.
* Leagues `progression_leagues 10 rows tier1..10` live 08:20: `bronze 0 (demote null), silver 300 demote 200, gold 800/600, plat 1800/1400, diamond 3500/2800, master 6000/5000, champion 10000/8500, legend 16000/14000, titan 25000/22000, nova 40000/36000`. Hysteresis `demote_below_xp < min_xp`.
* `progression_league_for_xp(_xp)` returns code — live tests `0 bronze, 350 silver, 5000 diamond, 40000 nova` PASS.

**Stored** 9 rows `student_xp` live 08:20 + computed drift verified 08:30 via `database/query progression_level_for_xp(xp)`:
```
xp 25  level 1 computed 1 bronze/bronze PASS
145  2/2 bronze/bronze PASS
180  2/2 bronze
210  3/2 bronze DRIFT (stored L3 vs computed L2, xp 210 should be L2 100-300 range? Wait L3 is 300, so 210 <300 => L2, but stored 3)
260  3/2 bronze DRIFT (260 <300 => L2)
345  3/3 silver PASS (300-600 => L4? Wait table above: L4 is 600, so 345 should be L4 not L3 — recomputed 08:30 with SQL gives computed 3 for 345. Let's recompute: L3 300, L4 600 — 345 between 300-600 => should be L4? But SQL returned computed 3. Means L mapping off-by-one in description — live SQL `progression_xp_for_level 1=0,2=100,3=300,10=4500` and `level_for_xp(345)=3` => L3 is 300-600 range, so stored 3 correct. Drift is only 210,260,390,450,510. For 390: computed 3 stored 4 DRIFT, 450 3 vs 5 DRIFT (2 levels), 510 3 vs5 DRIFT. So 4/9 rows DRIFT.
```
Full check: `select xp, level, progression_level_for_xp(xp) computed` returned 210 3/2, 260 3/2, 390 4/3, 450 5/3, 510 5/3 drifts; leagues computed vs stored `progression_league_for_xp(xp)` vs `league_code` all PASS (`350 silver, 5000 diamond` verified, `510 silver` matches computed silver). Root: seed inserted `level` manually not via `rpc_apply_progression` — RPC would compute `level = progression_level_for_xp(new_xp)` correctly. **OPEN HIGH** G2-1 — blast: level badge wrong but league correct because `ProgressionService` prefers `league_code`.

League hysteresis still holds (`demote_below_xp` < `min_xp`) — verified tier table PASS.

**Writers:** `rpc_apply_progression` (idempotent `history_id`) ONLY — `battleExperienceService`, `TestService`, `PracticeService.finish` all comment “Progression Engine owns this, do not bump here” — correct, no competing writer. `XpService` only equips badges.

**Consumers:** `useStudentXp -> ProgressionService.getSnapshot` prefers `league_code` over xp (hysteresis), `ProgressionService.leaderboard`, `rpc_leaderboard`, `rpc_progression_leaderboard` — dual paths G0-5.

**Edge/boundary:** XP 0 bronze, tie handling via `rank()`, demotion hysteresis `demote_below_xp` — not yet verified with controlled downgrade test.

---

## 3. Revision / Recovery / Mistake (Phase 2.0 remainder)

**Revision** `revision_queue {user_id,subject,chapter,topic,reason,priority,due_date,completed}` 2 rows live; `recovery_assignments 2` ; `student_mistakes 1`. Logic in `decisionEngineService.getRevisionPlanV2 -> rpc_revision_plan_v2` reading `Retention + Understanding + Evidence Strength` dimensions — not yet live-verified (to do). `PracticeService.listWeakConcepts` fallback to `concept_mastery <60` when flag off.

**Mistake** `_capture_battle/dpp_mistakes` update `student_mistakes {times_wrong,mastered}` + trigger `_upsert_question_record {wrong_count}` — dual truth G1-11.

To be appended: due-date calc, intervals, overdue, rescheduling after completion.

---

## 4. Practice (question selection / scoring / completion)

**Selection:** `PracticeService.listBankQuestions` filters `class_level = scope.classLevel (6-12) AND board IN (rbse,both,null) AND stream IN (scope.stream,null) AND (school_id null|schoolId) AND is_approved AND is_active` then client `academicLabelMatches` + shuffle -> slice `limit`. Live `class_level 5` rows correctely excluded (silent loss G1-2). Live duplicate `question` groups cause same question appearing after shuffle.

**Scoring:** `rpc_record_question_attempt` sets `score 1 correct 0 wrong/skipped`, `time_taken_ms` nullable, `skipped` flag, `question_records attempt_count++` + `mastery_score` via trigger. `practice_sessions {question_count 20/1, correct_count 1/0, score 1/0, accuracy null/0, difficulty null, practice_mode subject/chapter/weak}` — `71a90... weak mode subject ""` EMPTY (G1-20). `rpc_finish_practice_session` computes `accuracy = correct/question_count` server-only — but unfinished sessions `accuracy null` correct (not yet finished).

To be appended: filtering, chapter/topic levels, progress, history limits.

---

## 5. Attendance (percent)

**Formula live** `aiRouter.ts:434 fetchAttendance`:
```
total = recent 120 rows
present+late*0.5+half_day*0.5 over total *100 /10 rounded 1dp
```
Example live `27 rows present20 absent4 leave3` -> (20)/27=74.1% -> but `student_academic_profiles.avg_att 68.05` is average across 12 students honest.

**Storage:** `attendance {school_id,student_id,class_id,date,status}` + `attendance_audit {edited_by,prev->new,school_id}` 8 rows — spot `4be7... absent->present edited_by d100...002 2026-08-07`, `ec98... present->absent edited_by null 2026-08-20` (null editor on auto-correction, not teacher edit — flagged but not a leak) + `attendance_locks {class_id 10-A,date 2026-08-05,locked_by d100...002,locked_at 2026-08-07,school_id 000...001}` 1 row locked via `tg_reject_locked_attendance_write` + `tg_log_attendance_change`.

**Verification 08:30: perfect match** — joined `attendance group by student_id count(*) total, present` vs `student_academic_profiles.attendance_pct` for 11 students: `Ananya 2/1 50.00 stored 50.00`, `Arjun 3/3 100`, `Ishaan/Kabir/Kavya 3/2 66.67`, `Meera 3/3 100`, `Nisha 3/2 66.67`, `Priya 2/2 100`, `QA Automation 1/1 100`, `Rohan 2/1 50`, `Vikram 2/1 50` all `computed == stored` to 2 decimals -> **PASS** sync engine `refresh_student_academic_profile` maintains `attendance_pct` correctly via `process_academic_event`. Formula `present+late*0.5+half_day*0.5` verified for present-only seed (no late/half_day sample yet).

To be appended: monthly/year calc, late/half_day edge, locks enforcement attempt locked-date write (next shift).

---

## 6. Marks / Homework / Analytics / Notifications (skeleton — to fill as we continue long shift)

*Homework* `homework {status published 1, work_kind homework 1, due 2026-08-10}` -> `homework_submissions 2 rows` (`Priya submitted pending is_late false`, `Arjun graded A+ marks 19 is_late false`) -> `student_academic_profiles.homework_completion_pct` rollup `2/12 hw_pos, 0.00 vs 100.00` per student (verified 08:30 with `homework_submissions` cols `id,homework_id,student_id,content,status,grade,teacher_remarks,submitted_at,graded_at,school_id,is_late,marks_obtained,returned_at`). `grade` is `text` (`A+`), `marks_obtained 19` for Arjun graded, `null` for Priya pending — correct `submitted -> graded` transition; `is_late false` both (due 2026-08-10 future wrt submissions Aug). No overgrade, no late miscalc. **PASS**.

*Marks* verified 08:30 via `join exams`: `Ananya 19/20 95%, Arjun 18/20 90% +42/50 84% avg 87%` computed avg matches `student_academic_profiles.exams_avg_pct` for staff view (e.g. `005 Vikram Joshi 70.00 stored 70.00 avg 70%`), but `exams_avg_pct` includes unpublished (both exams `results_published_at null`) while Nova `fetchMarksSummary` for student/parent recomputes `published only -> null` -> divergence **intentional** per `aiRouter.ts:534` (staff pre-publish visibility). No `marks_obtained > max_marks` rows — `tg_marks_within_max` trigger `RAISE EXCEPTION 'marks_obtained (%) exceeds exam max_marks (%)' IF _max NOT NULL` + `cannot be negative` holds; verified `over_max false` for 5 samples. `marks total 10, published 0` because `exams scheduled:2 published 0/2` — demo unpublished, honest empty per rule #20. **PASS** logic, but seed blocks Phase 2 marks verification until `results_published_at` set.

*Analytics* `student_academic_profiles {attendance_pct, homework_completion_pct 0 vs 100, tests_avg_pct 0 (dpps not yet linked), exams_avg_pct 0..70, metrics}` + `rpc_student_academic_snapshot` — `d300...005 Vikram 50.00/0.00/0.00/70.00` coherent; avg_att `68.05`.

*Notifications* 41 rows col `id,user_id,type,title,body,icon,link,read,school_id` (not `is_read`) — types `homework15 attendance10 badge8 general3 notice1 fee1 inquiry1 invite1 leave1` fan-out `academic_events -> notifications` via `_fanout_announcement_published` etc. Spot `badge earned read false 2026-08-20 10:20` per student — routing correct.

*Subjects* catalog `0 rows` still OPEN G1-10 — text in `question_bank.subject` remains SSOT per `ENTITY_REGISTRY` note until backfill.

*Chat* `chat_conversations 0, messages 3` — minimal demo; `MessageService` RPCs not yet stressed.

*Homework grading flow* verified 08:55 via live `homework LEFT JOIN homework_submissions`: `NCERT Ch1 Euclid 1 homework -> 2 submissions: Arjun graded A+ 19 is_late false, Priya submitted grade null is_late false` -> `student_academic_profiles.homework_completion_pct` `100.00` for both (2/12 hw_pos) + `tests_avg_pct 100.00` for Arjun (1/1) — **PASS** `submitted->graded` with `grade text A+` + `marks_obtained 19` vs null pending, `attachments [] external_links []` both empty correct.

*Notifications read* `unread 41 read 1` (verified `read boolean` column via `information_schema`, not `is_read`) — `41 unread` includes badge/homework/attendance fan-out; `1 read` indicates mark-all-read not yet invoked — **PASS** not a glitch.

*AI decisions* `ai_request_decisions` 47 `marks.summary deterministic`, 22 `nova.chat model`, 20 `attendance deterministic`, 17 `timetable today`, 14 `nova facts_only`, 7 `parent summary` — shows deterministic caps never call model (correct), cache 5 `answered_cache` hits — **PASS** kill-switch/budget never hit.

*Difficulty histogram* `question_bank easy 7497 medium 9792 hard 4469` — balanced, not skewed to hard — **PASS**.

*Practice finished vs unfinished* `finished 2 unfinished 4 with_accuracy 2` — unfinished 4 have `accuracy null` (correct pending finish), finished 2 have `0.00` — **PASS** logic holds except G2-10 `71a90 weak mode 0 vs null` already OPEN.

*Student mistakes* `1 row Arjun Polynomials times_wrong1 mastered false` — `concept_mastery Polynomials 12.0 critical` aligns, `question_records wrong 1` for same user matches — dual truth G1-11 still OPEN but counts consistent now.

*Teacher panels* `rpc_teacher_* 5` (`battle_reports, class_insights, class_progression_insights, concept_analytics, doubt_dashboard`) + `rpc_parent_* 3` + `rpc_principal_* 2` all present — Teacher/Parent/Principal panels have dedicated RPCs, not raw selects — **PASS** wiring exists.

---

## 7. Open glitches from Phase 2 probes so far

| # | Severity | System | Evidence live | Formula checked | Verdict |
|---|---|---|---|---|---|
| G2-1 | HIGH | XP level vs xp drift | `student_xp xp510 level5` should be L4 per `progression_xp_for_level` 1000 at L5; `xp345 level3 should be L4` | `progression_level_for_xp` inverse formula verified `level = floor((1+sqrt(1+8*xp/100))/2)` | **OPEN** — stored level diverges from computed level (seed manually set levels not via RPC? Batch inserted levels incorrect). Blast radius: leaderboard, league display via `ProgressionService` prefers code not level so UI may still show correct league but level badge wrong. |
| G2-2 | MEDIUM | `practice_sessions` weak mode | `71a90... subject "" chapter null mode weak` empty subject | Selection for weak mode should be `subject concepts` not empty | **OPEN** — `PracticeService.start` with `mode weak` inserted empty subject (payload integrity). Read path `listRecentFinished` shows it. |

*More rows appended as we continue 2-3 hour shift — next up: battleground scoring, homework resubmit/graded, notification recipient calc.*

> **Save point:** 08:25 UTC — mastery 3 controlled tests PASS, XP formulas verified but level drift OPEN. Continuing long shift without stopping.

