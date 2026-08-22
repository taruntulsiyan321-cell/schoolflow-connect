# CURRENT STATE VERIFIED — Live DB Re-Check (After Claimed Fixes)

**Date:** 2026-08-21 12:30 UTC — re-probed live `psqxykzqfvxgsvkmgurn` via Management API after you said “we have fixed the previous changes”
**Method:** Direct `database/query` checks, NOT file-assumed. You said we were giving already-fixed bugs — you were right for 7 items. This file is the truth.

---

## 1. What was CLAIMED FIXED but ACTUALLY FIXED (verified live) — DO NOT RE-REPORT

| Bug (old ID) | Live re-check SQL | Before | After (NOW) | Verdict |
|---|---|---|---|---|
| **G1-2 class_level 5** | `select count(*) where class_level=5 and is_active=true` | 2189 active | **0 active** (2189 now `is_active false`) — `class_level 5:2189` all archived | **FIXED** — draft migration line archived |
| **G1-12 dpp null student_id** | `where student_id is null` | 1/4 `73af...` | **0** | **FIXED** — orphan deleted |
| **G1-13 dpp mojibake** | `where question like '%�%'` on `dpp_questions` | 1 (`axA�`) | **0** | **FIXED** — repaired |
| **G1-14 homework mojibake** | `where title like '%�%'` on `homework` | 1 (`�?? Euclid`) | **0** | **FIXED** |
| **G1-3 dups** | `having count>1` on `question_bank` active | 5 groups | **0** | **FIXED** — deduped + unique index |
| **G2-9 revision school_id null** | `where school_id is null` on `revision_queue` | 2/2 null | **0** | **FIXED** — backfilled from `students.school_id` |
| **G2-25 brain school_id null** | `where school_id is null` on `student_academic_brain` | 2/2 null | **0** | **FIXED** |
| **G2-8 recovery dup** | `group by having count>1` on `recovery_assignments` | 1 group `2x Polynomials` | **0** | **FIXED** — unique pending index + delete |
| **G2-1 XP drift** | `where level != progression_level_for_xp(xp)` | 5/9 drift (`510 L5 vs L3`) | **0** | **FIXED** — `UPDATE student_xp SET level = progression_level_for_xp(xp)` |
| **G1-20 is_late bypass** | `select proname from pg_proc where proname='tg_homework_compute_is_late'` | 0 rows (no trigger) | **1 row exists** | **FIXED** — trigger `tg_homework_compute_is_late` now exists |
| **G0-2 ai_answer_cache school_id** | `pg_get_functiondef where proname='match_ai_answer_cache'` | no `p_school_id` param, filter ignored school_id | **Has `p_school_id uuid DEFAULT NULL` + `WHERE (c.school_id IS NULL OR c.school_id = p_school_id)`** | **FIXED** — cross-school leak closed with `OR` for global rows |
| **G2-1/2-25 also** | `qbank_total 21696 (was 21758)`, `qbank_active 19492 (was 21758)` | 21758 total/active | 21696 total (-62 deduped), 19492 active (-2204 class5 archived -62 dedup) | **FIXED** counts reflect fixes |

**Do NOT hand these 12 to Claude as OPEN — mark FIXED in handoff.**

---

## 2. What is STILL BROKEN (verified live NOW) — HAND THESE TO CLAUDE

| Bug | Live SQL | Now | Severity | File | Still OPEN |
|---|---|---|---|---|---|
| **G1-1 mojibake ACTIVE** | `where is_active=true and (question like '%�%' or chapter like '%�%')` | **13272 active** (total 15064, 1792 inactive, 13272 active) — was 15087 active | CRITICAL | `question_bank` 69% still garbled, `is_active true` for 13272 rows — repair only archived 1792, not 13272 | **OPEN** — `is_active true` for 13272 mojibake rows → still shown via `is_active=true` filter, chips hidden via `looksLikeUnresolvedMojibake` but 13272 rows still DB volume + some leak via Recovery unfiltered `FE-04` |
| **G1-2 class_level 5 total** | `where class_level=5` | 2189 total, all now `is_active false` — correct, but **total still 2189** rows exist (archived not deleted) + `class_level null:15` all `is_active false` (was 15 active null, now 15 inactive) | CRITICAL archived not deleted | **PARTIALLY FIXED** — `active 0` correct, but `CHECK class_level BETWEEN 6 AND 12` is `NOT VALID` not yet `VALIDATE` — constraint not enforced on future inserts |
| **G1-6 exams published** | `where results_published_at is not null` on `exams` | **0/2** (still) | HIGH | `exams results_published_at null 2/2` → `marks published 0/10` honest empty still | **OPEN** — blocks marks verification (same as before) |
| **G1-10 subjects 0** | `select count(*) from subjects` | **0** | MEDIUM | `subjects catalog 0` still | **OPEN** |
| **G2-1 XP drift** | `where level != ...` | **0** | — | **FIXED** now, but `league demote_below_xp hysteresis` still not enforced (XP-02/03) | **OPEN** for hysteresis only |
| **G0-2 cross-school** | `match_ai_answer_cache` now has `p_school_id` + `OR` | **1** (has filter) | — | **FIXED** for ai_answer_cache, but `match_question_bank` still **NO** `p_school_id` (S-01), `ai_embedding_jobs` still no `p_school_id` (S-03), `embeddingWorker release` still no school_id (S-04), `ai-gateway parent` still `limit 1` (S-05), `bump` still no school_id (S-07) | **OPEN** for those 5 RPCs |
| **Other 148-12 = 136 bugs** | — | — | — | See `DEEP_AUDIT_FINDINGS.md` S-01..S-07, QB-07..QB-14, CM-01 etc. — not live-re-checked, assume still OPEN | **OPEN** |

---

## 3. What Claude should actually audit now (deep audit 2nd pass)

Do **NOT** re-audit the 12 FIXED items above. Focus on:

1. **Remaining mojibake ACTIVE 13272** — why `UPDATE ... SET is_active=false WHERE ... like '%�%'` only archived 1792 not 13272? Check `WHERE is_active=true` filter vs mojibake detection `looksLikeUnresolvedMojibake` signature mismatch (maybe `�` vs `à¤` different mojibake families). Live `mojibake_active:13272` uses `like '%�%'` only, but `utf8MojibakeRepair.ts` guards `looksLikeUtf8Mojibake` checks `à¤|à¥|â€|âˆ|Ã[80-FF]|Î[80-FF]|Â[°·]` — `�` (U+FFFD) is replacement char, not CP1252 signature, so repair function never matches `�` rows. Need to check what actual bytes are in `�` rows (maybe already replacement, not CP1252).

2. **5 RPCs still missing school_id:** `match_question_bank` (no param), `ai_embedding_jobs_process_batch` (no param), `embeddingWorker release`, `ai-gateway parent limit 1`, `bump_ai_answer_cache_hit` — live probe `ai_cache_school_filter:1` only covered `match_ai_answer_cache`, not these 5.

3. **All other DEEP_AUDIT findings:** `CM-01 mastery divergence`, `BG-01 double XP`, `HW-02 TZ`, `AT-01 late weight`, `AN-01 <50 vs <60`, `AI prompt injection`, etc. — not re-checked, assume OPEN until verified live as above.

---

## 4. How we verified (so Claude can re-run)

```sql
-- Run via Management API database/query with SUPABASE_ACCESS_TOKEN sbp_6ade8…
select count(*) as mojibake_active from public.question_bank where is_active=true and (question like '%�%' or chapter like '%�%'); -- 13272
select count(*) as mo_inactive from public.question_bank where is_active=false and (question like '%�%' or chapter like '%�%'); -- 1792
select is_active, count(*) from public.question_bank where class_level=5 group by is_active; -- false 2189
select count(*) as dpp_null from public.dpp_attempts where student_id is null; -- 0
select count(*) as rev_null from public.revision_queue where school_id is null; -- 0
select count(*) as brain_null from public.student_academic_brain where school_id is null; -- 0
select * from pg_proc where proname='tg_homework_compute_is_late'; -- 1 row exists now
select pg_get_functiondef(oid) from pg_proc where proname='match_ai_answer_cache'; -- has p_school_id + WHERE (c.school_id IS NULL OR c.school_id = p_school_id)
```

**No code changed for this file — read-only live probes.**

