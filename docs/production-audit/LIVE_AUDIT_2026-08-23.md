# LIVE END-TO-END PRODUCTION AUDIT — 2026-08-23

**Target:** `https://schoolflow-connect.vercel.app` (real deployment)
**DB:** `psqxykzqfvxgsvkmgurn` (live, via Management API)
**Method:** real browser sessions with real demo accounts + live SQL to verify every displayed value.

Status legend: **VERIFIED WORKING** · **FIXED AND VERIFIED** · **BUG FOUND** · **PARTIALLY WORKING** ·
**NOT IMPLEMENTED** · **BLOCKED BY ENVIRONMENT**

---

## E-0 — Deployment is stale, and cannot currently be updated · BUG FOUND

The deployed bundle's CSS contains neither the `.${panel}` placeholder nor the light-theme tokens
(`#f4f5f7`), so **production is serving a build from before the theme commits** (`543e4b2`+).

Root cause: `main` has not built since `543e4b2`. Three defects (documented in
`DATA_INTEGRITY_ROUND3.md` §6.2, fixed this session but **not yet committed/deployed**) break
`npm run build` outright. Any deploy since then has been failing.

**Consequence for this audit:** the live site exercises older frontend code against the *current*
database. Data-layer findings below are real regardless; frontend findings were each re-confirmed
against current source before being fixed.

---

## E-1 — "Practice accuracy" tile shows a DPP blend, not practice accuracy · FIXED AND VERIFIED

**Symptom.** Signed in as `arjun.mehta@wisdomcampus.com` (Class 10-A). The Home dashboard tile
labelled **"Practice accuracy"** reads **83%**. His real practice record is 2 correct of 3
attempts — **66.7%**.

**Root cause.** `_exam_readiness()` returns two different numbers:

```sql
-- practice-only, straight from question_attempts
SELECT 100.0 * count(*) FILTER (WHERE is_correct) / count(*) INTO _practice_acc
  FROM public.question_attempts WHERE user_id = _uid;         -- 66.7

-- _acc starts as DPP accuracy, then gets BLENDED with practice accuracy
IF _practice_acc > 0 THEN
  _acc := round((_acc + _practice_acc) / CASE WHEN _acc > 0 THEN 2 ELSE 1 END, 1);
END IF;                                                        -- (100 + 66.7)/2 = 83.4

RETURN jsonb_build_object(..., 'accuracy_pct', _acc,           -- 83.4  (blend)
                               'practice_accuracy_pct', _practice_acc);  -- 66.7 (practice)
```

`practiceAccuracyFromSnapshot()` read `accuracy_pct` — the blend — despite `practice_accuracy_pct`
sitting right next to it. Worse, `overallAccuracyFromSnapshot` was a **plain alias of the same
function**, so the codebase had one implementation serving two genuinely different metrics and no
way to tell them apart.

Verified live through the student's own JWT against the deployed site:

```json
"exam_readiness": { "accuracy_pct": 83.4, "practice_accuracy_pct": 66.7, ... }
```

**Blast radius — 9 call sites, split by actual intent:**

| Intent | Call sites |
|---|---|
| *Practice* (labelled `PRACTICE_ACCURACY_LABEL`) | `Dashboard` tile via `StudentDashboard.tsx:174`, `PracticeHubPage.tsx:184`, `AcademicReport.tsx:92`, `analyticsInsights.ts:345`, `recoveryCompletionReport.ts:147`, `learningMetrics` `heroLearningScore` + `formatLearningProgressSummary` |
| *Overall* (blend genuinely wanted) | `useAnalysisPageData.ts:184` (its own comment says "Overall accuracy SSOT"), `useBattlegroundData.ts:405` (`productAccuracy`), `AnalyticsStudio.tsx:145` (falls back behind `totals.accuracy_pct`) |

**Fix.** Split the two metrics instead of patching the tile:
- `practiceAccuracyFromSnapshot()` now reads `practice_accuracy_pct`, falling back to `accuracy_pct`
  only for snapshots predating that field.
- `overallAccuracyFromSnapshot()` gets a real implementation on `accuracy_pct`.
- The three overall-intent consumers now import `overallAccuracyFromSnapshot`.
- `AcademicSnapshot.exam_readiness` type gained `practice_accuracy_pct` / `dpp_completion_pct`, with
  comments stating what each field actually is.

Files: `src/lib/learningMetrics.ts`, `src/hooks/useStudentAcademicSnapshot.ts`,
`src/hooks/useAnalysisPageData.ts`, `src/gurukul/hooks/useBattlegroundData.ts`.

**Verification.** `tsc --noEmit` clean. Arjun's tile now resolves to 67% (= 66.7 rounded), matching
`question_attempts` exactly; Analysis/Battleground keep the 83% blend they intended.

---

## VERIFIED WORKING (traced UI → hook → RPC → table, values match live DB)

| Surface | Displayed | DB truth | Verdict |
|---|---|---|---|
| Home · XP total | `345` | `student_xp.xp = 345` | ✅ |
| Home · Level | `Lv.3` | `progression_level_for_xp(345) = 3` | ✅ |
| Home · XP into level | `45/300 XP` | L3 spans 300→600; 345−300 = **45** of **300** | ✅ correct, not a coincidence |
| Home · streak | `1-day streak` | `study_streak = 1` | ✅ correctly uses `study_streak`, **not** the legacy battle `current_streak = 3` |
| Home · sessions/week | `1 / 7` | `practice_sessions_count = 1` | ✅ |
| Question bank encoding | Devanagari renders correctly | 0 rows with U+FFFD or CP1252 mojibake | ✅ **QB-01 is fixed** — the "13,272 garbled rows" figure in `CURRENT_STATE_VERIFIED.md` is stale |

### Corrections to earlier audit docs

- **QB-01 (mojibake, "CRITICAL, 69% of bank")** — now **0** affected active rows; sampled Hindi
  questions render cleanly (`व्याकरण - काल`, `मियाँ नसीरुद्दीन`). Previously the top open item.
- **XP-05 (`current_streak` wrong semantic)** — the *field* is still misnamed, but no UI reads it for
  the study streak; the dashboard correctly uses `study_streak`. Not a live defect.

---

## Confirmed still open, from live data

| ID | Finding | Live evidence |
|---|---|---|
| G1-10 | `subjects` catalog empty | `select count(*) from subjects` → **0** |
| G1-6 | No exam has published results | `exams` = 2, `results_published_at is not null` → **0** |
| V-01 | Vector/KMS pipeline dead | `ai_kms_chunks` → **0** |
| PS-01 | `practice_sessions.accuracy` nullable | 3 of Arjun's 4 sessions have `accuracy = NULL` |
