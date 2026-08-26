# Student Panel + Nova — Computation & Logic Review

**Date:** 2026-08-23
**Scope:** Student panel only — how its numbers are computed, and the student AI (Nova).
Cross-panel wiring and mojibake repair deliberately excluded per instruction.
**Method:** Read the live code paths end to end; routing claims proven by executing the real
mapper; the marks divergence proven numerically. No live DB, so no row-level claims are made.

---

## 1. VERIFIED WORKING — do not re-report

Nova's safety architecture is genuinely well built. These were checked directly, not assumed:

| Area | Finding |
|---|---|
| **Output grounding** | `validateModelResponse` runs on **all three** model-calling student capabilities — `performance.explain` (2041), `concept.explain` (3154), `nova.chat` (3972). Numeric claims (attendance/marks/mastery/XP/level/streak/any-%) are regex-extracted and checked against an allow-list built from the real facts. On `material_failure` the model text is **discarded** (`explanation: null`) and the answer degrades to facts-only. |
| **Cached-answer reuse** | Two-stage gate: similarity ≥ 0.65 to retrieve, but EXACT reuse requires ≥ 0.78 **and** `numbersMatch`. Below that the hit becomes a *reference* folded into the prompt as a worked method, never a ready answer. The in-code rationale (same-template-different-numbers can outscore a genuine paraphrase) is correct and empirically grounded. |
| **Tenant scoping of RPCs** | `match_question_bank` / `match_ai_answer_cache` both receive `p_school_id: req.actor.schoolId`. Old insecure signatures were dropped, not shadowed. |
| **Cache keys** | `cacheKeyBase = feature_id:studentId`; L1 also namespaced by `schoolId`; L2 reads scoped by `schoolId`. `examsVisibilityTier` is correctly applied on `nova.chat`, the one path whose facts (`fetchParentSummary`) are role-dependent. |
| **Prompt injection** | Layered and honest: spotlighting tags + system/user role separation + output-side tripwires. Importantly, the client-supplied chat history and practice-question context are folded **inside** the `<student_input>` wrapper (3884), not appended as trusted text — the correct choice. |
| **Client bounds** | Server re-caps everything: 6 turns × 500 chars, 3 images × 8 MB, options × 8. Comments explicitly say "never trust client bounds." |
| **Honest failure** | Image-generation requests are detected and declined outright rather than forwarded to a text model that would hallucinate having drawn something. Budget/model failure degrades to facts-only, not silence. |
| **Attendance formula** | Deliberately aligned to `refresh_student_academic_profile` (present-only over marked days) with a comment explaining the prior divergence. Formula is right — but see **F5** for its row scope. |
| **Practice stats** | `practiceSessionStats.ts` is a clean SSOT: DB-first, documented derivation fallback, `Number.isFinite` guard (so PS-01's NaN cannot occur), and `accuracyFromDb`/`xpFromDb` provenance flags. |
| **Mastery formula** | CM-01 is resolved — the client no longer computes mastery at all, it reads `concept_mastery.mastery_score`. Client (`masteryBands.ts`) and edge (`eieProjection.ts`) band cutoffs match exactly: 40/60/75/90. |

---

## 2. FINDINGS

### F1 — HIGH · Nova misroutes 2 of the app's own 8 suggestion chips

`src/academic/ai/intentMapper.ts` is first-match-wins over an ordered list, and the early rules
are single broad words (`/\bmarks?\b/`, `/\battendance\b/`, `/\bhomework\b/`). More specific
intents sit *below* them and can never be reached. Proven by executing the real mapper:

| Student types | Routes to | Should be |
|---|---|---|
| **"How am I doing in attendance and marks?"** ← chip #8 | `student.attendance.query` | `student.performance.explain` (which literally has `/\bhow am I doing\b/`) |
| **"Summarise my weak concepts"** ← chip #7 | *falls through to* `student.nova.chat` | `student.eie.mastery_summary` |
| "Explain my marks" | `student.marks.summary` | `student.performance.explain` |
| "Explain my attendance" | `student.attendance.query` | `student.performance.explain` |
| "Explain how marks are calculated in physics" | `student.marks.summary` | `student.concept.explain` |

Two distinct root causes:

1. **Ordering.** Broad patterns shadow specific ones. The rule objects carry a
   `confidence: 0.85` field that is **computed and then never used** — nothing ranks matches by
   specificity, so the list order silently *is* the priority.
2. **Plural blindness.** `student.eie.mastery_summary` matches `/\bweak\b.+\b(topic|concept|chapter)\b/i`.
   `\bconcept\b` does not match "concept**s**", so "weak concepts" misses. The app's own chip
   uses the plural.

**Impact.** Chip #8 answers a different question than asked. Chip #7 is worse: it abandons a
deterministic, grounded capability and pays for a generic LLM call instead — the exact
"model-last" principle the router is built around, inverted.

**Fix sketch.** Score all matching rules and take the most specific (longest/most-anchored
pattern) rather than the first; add `s?` to the noun alternations. A regression test over the
eight `SUGGESTIONS` entries in `AICoach.tsx` would have caught both.

### F2 — HIGH · Nova's exam average disagrees with every other student surface

Two live implementations of "the student's average exam %", both student-facing:

| | Path | Formula | Row cap | `max_marks = 0` |
|---|---|---|---|---|
| **A** | `marksRepository.getPublishedExamsAverage` — Tests page, Analysis, `profile.examsAvgPct` | flat mean of **per-exam** percentages | 500 | exam **skipped** |
| **B** | `aiRouter.fetchMarksSummary` — **Nova** | mean of **per-subject** means | 100 | silently treated as **100** |

They only agree when every subject has the same number of exams. Worked example — Maths 4 exams
at 50%, Physics 1 exam at 100%:

```
Tests page / Analysis / profile : 60%
Nova says                       : 75%
                                  ── 15 percentage points apart, identical data
```

Two secondary defects inside B: `Number(exam.max_marks) || 100` **fabricates a denominator** when
`max_marks` is 0/null (A correctly skips those exams), and the 100-row cap silently truncates a
student with more marks rows than that.

This is the "competing versions of the same information" pattern — and it is *inside one panel*:
the student reads 60% on Tests and is told 75% in chat.

### F3 — MEDIUM · Nova's attendance % is computed over a different row set than the dashboard

`fetchAttendance` uses the right **formula** but `.limit(120)` (most recent 120 rows). The
authoritative rollup is:

```sql
count(*) FILTER (WHERE status = 'present'), count(*)
FROM public.attendance WHERE student_id = _student_id;   -- no limit, all rows
```

So the numbers coincide only until a student has 120 marked days — roughly the middle of an
academic year (~200 school days) — then drift, and the gap widens. A student absent early and
present lately gets a *flatteringly higher* number from Nova than from their dashboard.

The in-code comment states it "Matches `refresh_student_academic_profile`'s definition exactly."
That is true of the formula and false of the scope, which makes the divergence easy to miss.

### F4 — MEDIUM · Weak-concept threshold is split inside the student panel

| Surface | Source | Threshold |
|---|---|---|
| Analysis → "Needs attention" | `snapshot.weak_topics` (SQL rollup) | `mastery_score < 50`, `LIMIT 8` |
| Practice weak mode, Recovery, AICoach chips | `WEAK_CONCEPT_THRESHOLD` | `< 60` |

A concept sitting at mastery 50–59 is "weak, drill this" in Practice and Recovery, and simply
absent from Analysis's "Needs attention". The `weakAreasV2` flag that would replace the SQL path
defaults to `false` and is not set in `.env`, so the `< 50` path is what actually ships. The
`LIMIT 8` is an additional undisclosed truncation.

### F5 — MEDIUM · Four `concept_mastery` reads in the Nova path are not school-scoped

`aiRouter.ts` lines **674, 752, 1276, 1313** filter only `.eq("user_id", userId)`. These run on
the **service_role** client, which bypasses RLS — so the query's own `WHERE` is the only tenant
gate there is. Every sibling fetch in the same file (`attendance` 429, `homework` 471/491,
`marks` 541/550, `students` 646, `eie` 728/772 …) does add `.eq("school_id", schoolId)`.
`concept_mastery.school_id` exists (nullable).

Consequence if one `user_id` ever holds rows in two schools (transfer, dual linkage): mastery,
weak concepts, and — because 1276/1313 are the *probe* functions — the **cache `data_version`**
would all mix schools. Low likelihood today, but it is the one place in this file that departs
from the file's own established pattern.

### F6 — MEDIUM · Edge class-level parsing can't read Roman numerals, silently disabling question matching

`aiRouter.ts:3559` derives the class level for question matching with `/(\d+)/.exec(class_name ?? class_label)`.

If the label has no digits — "X-A", "XII-B" — `matchClassLevel` is `null` and the entire
two-stage question-bank + answer-cache lookup at 3558 is **skipped without any signal**. Nova
still answers, just without ever consulting the 21k-question bank.

The client already solved this: `parseClassLevel` in `src/lib/curriculumScope.ts` handles
VI–XII, and it was fixed *specifically because schools use Roman labels* (QB-07). The edge never
got the same treatment. `/(\d+)/` also takes the **first** digit run, so a label like
"Room 2 — Class 10" resolves to class 2.

### F7 — MEDIUM · Nothing enforces `student_xp.level == progression_level_for_xp(xp)`

The level is recomputed only *inside* the progression RPC (`_lvl_after := progression_level_for_xp(...)`).
`20260821120000_phase1_verified_fixes.sql:57` was a **one-time backfill** (`UPDATE student_xp SET level = ...`),
and no `CREATE TRIGGER` on `student_xp` exists anywhere in the migrations.

So the invariant is maintained by every writer remembering to — not by the database. XP-01 was
reported "FIXED", but the fix corrected the *data*, not the *cause*, so drift can silently
return. Both Nova (`fetchProgression` reads the stored `level` column at 682) and the dashboard
badge display it.

### F8 — LOW · The school-wide negative lookahead doesn't work

`/\b(?!school.?wide\b).*?\battendance\b/i` — the lookahead is evaluated at the match start, then
`.*?` simply consumes "school wide " and matches anyway. Currently harmless only because the
`principal.school.health_brief` rule is ordered above it and catches the phrase first. It is
dead defensive code that reads as if it works.

---

## 3. RESIDUAL RISK WORTH KNOWING (not a defect)

`recent_turns` is entirely client-supplied. A student can post fabricated history — e.g. a fake
`Nova: your attendance is 100%` turn — and it reaches the model. This is handled *well* on the
numeric axis: the output validator checks any attendance/marks/mastery/XP/% claim against real
facts and suppresses the reply on mismatch. It does **not** cover non-numeric fabrication
(invented classmate names, fabricated qualitative claims). The design is deliberate, layered, and
documented; I note it so the boundary is explicit, not because it is being handled wrongly.

---

## 4. SUGGESTED ORDER

1. **F1** — routing. Cheapest fix, and it is visibly wrong from the app's own chips.
2. **F2** — pick one average and have both paths call it. This is a correctness question the
   product must answer: is a student's average the mean of exams, or the mean of subjects?
3. **F3** — drop `.limit(120)`, or aggregate in SQL, and correct the comment.
4. **F6 / F5 / F7** — one-line-ish hardening each.
5. **F4** — needs a product decision on whether weak means 50 or 60, then one threshold.

Nothing in this review has been changed in code — findings only, as scoped.
