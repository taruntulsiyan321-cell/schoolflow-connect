# Recovery, Revision & Analysis — Specification

The paid feature. Everything else in the app records what happened; this is the
part that changes what happens next.

Read alongside `locked-decisions.md`. Where a constant appears here it lives in
**one module** and is tunable in one place — see §10.

---

## 1. What the three are, and why they are separate

They are often conflated. They answer different questions and must not share a
mechanism.

| | Question it answers | Driven by | Uses |
|---|---|---|---|
| **Recovery** | *Do I understand this yet?* | Mistakes accumulating | Old mistakes **plus** fresh questions |
| **Revision** | *Did it stay learned?* | Time passing | **Fresh questions only** |
| **Analysis** | *Where am I weakest, and is it moving?* | Reading both | Everything |

**The design principle underneath all three:**

> Answering the same question correctly a second time proves almost nothing. The
> student may remember the answer rather than the method.

Every rule below follows from that. It is why recovery mixes fresh questions in,
why revision uses fresh questions only, and why passing a recovery session is a
recommendation rather than a verdict.

---

## 2. The unit of tracking

**Chapter is the unit. Topic is a label.**

- **All triggers, thresholds and scheduling operate on `chapter_id`.** Chapters
  are real, stable, and there are 523 of them.
- **Topic is displayed as detail** — "within Cash Flow, you're weakest on bank
  reconciliation" — but **never triggers anything**, because 11,917 free-text
  strings cannot be trusted to group correctly (§10.10).
- As teacher-created content accumulates picked topics (§10.22), topic-level
  triggering becomes possible later. **Nothing needs rebuilding when it does** —
  the same rules apply one level down.

**Why not the question?** Too granular, and re-answering it is exactly the thing
that proves nothing.

**Why not the subject?** "You're weak in Accountancy" is not actionable.

---

## 3. Data required

Existing (§10.8):

- `practice_mistakes` — question, chapter, topic, first_wrong_at, times_wrong,
  last_attempted_at, status, cleared_at
- `practice_skipped`, `practice_bookmarks`
- `practice_sessions` — attempted_count, correct_count
- Time taken per question

### 3.1 The chapter tally — UN-PARK THIS. It is required.

Without a denominator, the mistake book is unreadable. Eight open mistakes in
Cash Flow means something entirely different out of 20 questions than out of 200.

**`chapter_tally`** — one row per chapter per session, not per question
`id · institution_id · student_id · chapter_id · session_id · attempted ·
correct · created_at`

A session covering three chapters writes three rows. Roughly 600 rows per student
per year. This is the cheap option — it exists so that per-question storage is
unnecessary.

**Every accuracy figure, every trend, and every "is this improving" answer comes
from this table.** Without it, analysis cannot be built.

### 3.2 New tables

**`chapter_state`** — one row per student per chapter
`student_id · chapter_id · state · recovered_at · next_revision_at ·
revision_stage · consecutive_revision_passes · last_recovery_readiness`

States: `untouched` · `has_mistakes` · `in_recovery` · `recovered` ·
`revision_due` · `revision_failed`

**`recovery_sessions`** and **`revision_sessions`**
`id · student_id · chapter_id · started_at · completed_at ·
old_correct · old_total · new_correct · new_total · readiness · outcome`

---

## 4. RECOVERY

### 4.1 When it is built, and when it is offered

**REVISED — the cooldown gate is removed. Sessions are built immediately and are
available immediately.**

**Two paths, one engine:**

| Path | Trigger | Then |
|---|---|---|
| **Automatic** | A practice session ends and a chapter now has `RECOVERY_TRIGGER_COUNT` (5) open mistakes | Session is built in the background, ~1–2 minutes. **No notification on completion** — it is simply there. |
| **On demand** | The student opens **"Redo my mistakes"** (§10.8 practice mode) | Serve from cache if enough variants exist — instant. Otherwise build in the background and tell them. |

**While it builds, the student sees:** *"Session complete. Your recovery session
is being prepared."* They have already finished practising; nothing blocks them.

**Build time is deliberately unhurried.** One to two minutes is the target, and
it may take longer under load. **The system must degrade by taking longer, never
by failing or by serving something worse.**

**Why there is no cooldown gate.**

The cooldown existed so a student could not answer from short-term memory. **The
transfer ladder already detects that**, and better: a student who starts recovery
minutes later aces tier 0 and tier 1 and fails tier 2 and tier 3, and the
readiness report tells them exactly that — *"you handled every calculation, but
when the same idea was asked differently, 2 of 5."*

**Diagnosing memorisation is better than preventing the attempt.** The student
learns something instead of being told to wait, and it matches the standing rule
that the app suggests and the student decides.

**Why 5.** Fewer than five is not worth a session, and clearing a one-mistake
chapter creates a false sense of progress.

**Chapter size is irrelevant.** A chapter holding 8 questions where the student
got 5 wrong still yields a full session, because the session is built from
generated variants rather than drawn from a finite pool.

### 4.1a Generation — background, never in front of a waiting student

**Nothing is ever generated while a student watches a loading screen.**

- Generation runs **after** a practice session ends, for chapters that have just
  crossed the trigger. Not for every wrong answer — most never reach a recovery
  session, and generating for them is paying for questions nobody sees.
- **Failures retry in the background. The student never sees them.** AI calls
  fail for ordinary reasons — timeouts, rate limits, an outage, output that will
  not parse — at roughly one call in a few hundred. At 210 students that is
  several times a week. Invisible with retry; a broken screen without it.
- **Bank first, always.** Check for existing variants before generating (§4.2a).
- A session that genuinely cannot be completed is **not offered**, rather than
  offered short. There is no student waiting, so there is no reason to degrade.

### 4.1b Notifications — escalating, and only if unsolved

- **No notification when the session is created.** It is simply available.
- If it goes **unsolved**, send escalating reminders — **at most one a day**,
  batched across chapters (*"3 chapters are ready to review"*).
- **Reminders stop the moment the student starts the session.**
- Not a single ping at a fixed 24 hours. The cadence responds to whether they
  have acted.

### 4.2 What the session contains — the transfer ladder

**A fresh question from the same chapter is a weak test.** If the student failed
debit/credit on bank reconciliation, a random Cash Flow question about operating
activities shares a chapter and tests nothing they got wrong.

**The session is built from the student's own wrong questions**, laddered by how
far each step moves from the original:

| Tier | What it is | What it proves | Count |
|---|---|---|---|
| **0 — Original** | The exact question they got wrong | Closes the specific loop | up to `RECOVERY_TIER0` (2) |
| **1 — Near** | Same question, **different values** | They can execute the procedure | `RECOVERY_TIER1` (3) |
| **2 — Mid** | Same concept, **different framing or structure** | They understand it, not just the steps | `RECOVERY_TIER2` (3) |
| **3 — Far** | Same topic, **different application** | It transfers | `RECOVERY_TIER3` (2) |

Tiers 1 and 2 are **AI-generated from the student's actual wrong questions**.
Tier 3 comes from the bank where coverage allows, AI otherwise.

**Why the ladder matters.** Each rung isolates a different failure:

| Pattern | Meaning |
|---|---|
| Tier 0 ✓, Tier 1 ✗ | Memorised the answer, cannot even repeat the method |
| Tier 1 ✓, Tier 2 ✗ | **Procedural only** — can run the steps, doesn't understand why |
| Tier 2 ✓, Tier 3 ✗ | Understands in a familiar frame, doesn't yet recognise it elsewhere |
| All ✓ | Learned |

Tier 1 ✓ / Tier 2 ✗ is the most common real result and the most useful thing
this feature detects. A single "did they get it right" figure cannot see it at
all.

**Difficulty matching:** variants mirror the difficulty of what was failed. If
they failed easy questions, hard variants teach nothing but discouragement.

### 4.2a Generating the variants

**Input to the AI:** the original question, its correct answer, its chapter and
topic, its difficulty, and the target tier.

**Rules:**
- Tier 1 must preserve the method exactly and change only values, names or
  context. Same steps, same answer shape.
- Tier 2 must preserve the concept and change the structure — reverse what is
  given and what is asked, embed it in a different scenario, or ask for a
  different output of the same idea.
- **The correct answer must be generated with the question**, so §10.8's
  auto-grade rule applies and grading is immediate.
- A variant that cannot be generated is **skipped, not faked**. The session runs
  short and says so.

**Every generated variant is saved to the shared bank** (§10.9), tagged with its
chapter, topic, difficulty, tier, and `source_question_id`.

**This is what makes it affordable.** A variant generated because Ravi failed a
question is there, free and instant, for the next student who fails the same one.
Early sessions are AI-heavy; within a term most recovery sessions are served from
cache. **Check the bank for existing variants before generating** — generation is
the fallback, not the default.

**Variants are ordinary bank questions.** They can be served in normal practice
to any student, which is fine and desirable.

### 4.2b Readiness on the ladder

```
procedural_rate  = tiers 0 and 1
conceptual_rate  = tiers 2 and 3

READY  when  conceptual_rate >= RECOVERY_CONCEPTUAL_THRESHOLD (0.70)
       AND   procedural_rate >= RECOVERY_PROCEDURAL_THRESHOLD (0.80)
```

**Two rates, never blended**, so the report can say which one failed and what
that means. "You can do the steps but the idea isn't solid yet" is actionable.
A single 74% is not.

### 4.4 Clearing — the student decides, the app advises

Locked decision: **the student is responsible for clearing their own mistake
book.** That stands. But an unadvised student clearing everything defeats the
feature, so:

1. The report leads with the readiness verdict and the reason.
2. **If not ready**, marking the chapter recovered requires an extra confirm —
   not a block, a speed bump.
3. Whatever they choose, **revision will catch it** (§5). A chapter cleared
   prematurely fails its 7-day check and returns.
4. `last_recovery_readiness` is stored, so analysis can later show *"cleared at
   52% readiness, failed revision"* — which is the honest signal, and far more
   useful than having blocked them.

**Do not block. Advise, then catch it downstream.** A student who cannot clear
their own book stops using the book.

### 4.5 On clearing

- Those `practice_mistakes` rows → `status = 'cleared'`, `cleared_at` set.
- `chapter_state` → `recovered`, `recovered_at` set.
- `next_revision_at` = now + first revision interval.
- `revision_stage` = 1.

---

### 4.6 Failing a recovery session — rounds and the accumulating pool

A session is **cleared** when readiness passes (§4.2b). Below that it fails, and
a new session is generated.

| Round | Contains | Generation |
|---|---|---|
| **1** | Originals + fresh variants | Fresh |
| **2** | Everything from round 1 **+ new questions** | Fresh |
| **3** | Everything from rounds 1–2 **+ new questions** | Fresh |
| **4+** | Drawn from the pool built across rounds 1–3 | **None** |

**Why fresh questions in every one of the first three rounds.** A student who saw
the same set each time would eventually pass by remembering those answers rather
than understanding the chapter — exactly what the transfer ladder exists to
detect. New material in each attempt makes that impossible.

**Why generation stops after round three.** By then the pool holds roughly thirty
questions, large enough that recycling is not trivially memorisable. And a
chapter that has failed three rounds is not going to be solved by buying more
questions. **The cap is explicit, and it holds cost on exactly the case where
spending is least useful.**

Rounds 4+ continue indefinitely from the pool. Nothing is blocked, nothing is
flagged, and nothing escalates to any other person.

**The mistake book never grows through recovery.**
- Every question the student got wrong is **already** in the book.
- Getting one wrong again **does not add a row** — it bumps `times_wrong`.
- **The count can only fall or stay level.** A student who opens recovery with 6
  mistakes and has a bad session still has 6. If it doubled, they would stop
  opening recovery.
- Entries leave **only when the student clears them** — from the mistake book or
  from the recovery report. Nothing clears automatically.

**No "stuck" state, and no suggestion to ask a teacher.** Repeated failure shows
in the student's own analysis as `times_wrong` climbing and the trend not
improving. That is enough. The app does not tell a child to go and ask for help.

**Test and homework mistakes feed this too.** Per §8, the recovery queue may draw
on school-data mistakes as well as practice ones — the storage stays separate,
the queue does not.

---

## 5. REVISION

### 5.1 Purpose

Recovery asks *do you understand it now*. Revision asks *did it stay*. Only the
second one is evidence of learning.

### 5.2 What starts the clock

**Revision is scheduled after any meaningful engagement with a chapter — not
only after recovery.**

A student who practises Cash Flow, scores 18 of 20 and has nothing to recover
still needs reminding a week later. Scheduling only after recovery would leave
their strongest work unrevised, which is backwards.

The clock starts on either:

```
a) A chapter is marked recovered, OR
b) A session in which the student attempted >= REVISION_ENGAGEMENT_MIN (10)
   questions in that chapter
```

Re-engaging with a chapter **resets the clock** — a student actively working on
something does not need a reminder to revise it.

**The two paths differ only in what failure costs:**

| Started by | On failure |
|---|---|
| **Recovery cleared** | Mistakes reopen, chapter returns to recovery, stage resets |
| **Practice engagement** | New mistakes recorded, chapter enters recovery normally |

Same session, same threshold. Only the consequence differs.

### 5.3 The schedule

Three checks:

```
REVISION_INTERVALS = [7, 21, 60]   // days
```

Pass all three → `consecutive_revision_passes = 3` → the chapter leaves the
revision queue and is considered solid. It re-enters only if new mistakes appear.

**Why 7 / 21 / 60.** Roughly tripling, which is the shape of every effective
spacing schedule. Seven days is past the point where short-term recall carries
you. Sixty days spans a term, so passing the third check means it survived
genuine forgetting. Three checks is enough to distinguish learning from cramming
without nagging a student who has clearly got it.

**Timing is a suggestion, never enforced.** Locked decision: *app suggests,
student decides.* An overdue revision surfaces in analysis and in notifications;
it never blocks anything and never auto-starts.

**The notification must name what and when**, because the student will not
remember on their own — that is the entire point:

> *"You worked on Cash Flow Statement 7 days ago. Time to check it stuck."*

Not *"you have a pending revision."* The chapter name and the elapsed time are
what make it land.

### 5.4 What the session contains

```
REVISION_COUNT (default 8) fresh questions
same chapter, never seen by this student, difficulty matched
```

**Never the old questions.** Including them would test memory of specific
questions, which is precisely what revision exists to rule out.

### 5.5 Pass and fail

```
PASS  when  correct / total >= REVISION_PASS_THRESHOLD  (default 0.70)
```

**On pass:** `revision_stage += 1`, `next_revision_at` = now + next interval.
After stage 3, the chapter is solid.

**On fail:**
- `chapter_state` → `revision_failed`
- Newly wrong questions enter the mistake book as **new** entries
- **Previously cleared entries stay cleared.** They were cleared honestly at the
  time; resurrecting them muddies the history and inflates the count.
- `revision_stage` resets to 0
- The chapter re-enters recovery

### 5.6 If a chapter is never revised

Nothing punitive. It sits in the queue, ages, and appears in analysis as
*"recovered 40 days ago, never checked."* Honest, not nagging.

---

## 6. ANALYSIS

### 6.1 Governing rule

**Weaknesses only. Never strengths.** No "you're strong in Partnership", no
mastery percentage, no ranking of chapters by how good they are. The product
surfaces what needs work and nothing else.

### 6.2 No composite score

Do **not** compute a single "weakness score" per chapter. The same reasoning that
banned a blended class score applies here: the moment four signals become one
number, the student cannot act on any of them, and they cannot see inside it to
know whether to trust it.

Show the signals. Rank on the clearest one.

### 6.3 The chapter list — the main screen

One row per chapter with anything open. Sorted by `open_mistakes` descending,
with two pins to the top:

1. Any chapter with `revision_failed`
2. Any chapter with `repeated_mistakes >= 3`

Each row shows:

| Signal | Source | Why it matters |
|---|---|---|
| Open mistakes | `practice_mistakes` where open | The raw gap |
| Of those, repeated | `times_wrong > 1` | Failed after correction — the sharpest signal |
| Accuracy in this chapter | `chapter_tally` | The denominator; 8 of 20 ≠ 8 of 200 |
| Trend | `chapter_tally` over time | Is it moving? |
| Oldest open | `first_wrong_at` | Neglect |
| Revision status | `chapter_state` | Did it stick? |

### 6.4 Trend — the answer to "am I improving?"

From `chapter_tally`, per chapter, accuracy across the last N sessions:

```
IMPROVING   when the latest 3 sessions average > the previous 3 by >= 10 points
STUCK       when the difference is within 10 points
WORSENING   when it falls by >= 10 points
NOT ENOUGH DATA  when fewer than TREND_MIN_SESSIONS (default 4) exist
```

**`NOT ENOUGH DATA` must be a real, visible state.** It is not zero, not "stuck",
and not hidden. Declaring a trend from two sessions is noise dressed as insight —
the same "not entered is not zero" rule, applied to trends.

### 6.5 Inside a chapter

Topic breakdown, **clearly marked as approximate** because topic labels are
free text (§10.10):

- Mistakes by topic within the chapter
- Which topics were skipped most
- Average time per question versus the student's own average — **slow and
  correct is not mastery**, it is a fluency gap, and it is invisible in an
  accuracy figure

### 6.6 Skipped questions

Skipping is a **distinct signal from getting it wrong**, and in some ways
sharper: the student didn't attempt it. Repeated skipping in one chapter is
avoidance.

- Tracked and surfaced separately: *"you skipped 6 questions in Cash Flow"*
- **Never forced into recovery** — a skipped question is not a proven gap
- Offered: *"want to try the ones you skipped?"*

### 6.7 What analysis must never do

- Show strengths, mastery, or a positive score
- Show a composite weakness number
- Compare the student to other students (leaderboards are separate, §10.16)
- Declare a trend from fewer than `TREND_MIN_SESSIONS`
- Report school data (test and homework mistakes) inside the private practice
  analysis — see §8

---

## 7. Anti-gaming

The student controls clearing, so the design must assume some will clear without
learning. It does not block them; it catches them.

| Behaviour | What catches it |
|---|---|
| Clear everything without a recovery session | No `readiness` recorded; revision check follows anyway |
| Clear after a low-readiness session | Extra confirm; `last_recovery_readiness` stored and later shown |
| Memorise the specific questions | Fresh questions in recovery; revision uses fresh only |
| Rush to farm XP | Time per question surfaced in analysis; XP is effort, not mastery |
| Skip everything hard | Skipped tracked separately and surfaced |

**No blocking anywhere.** Every one of these produces a visible, honest signal
instead.

---

## 8. Interaction with school data

**Storage stays separate** (§10.23). Practice mistakes and test/homework mistakes
live in different tables, and nothing merges them.

**But the recovery queue may draw on both.** A student who failed Cash Flow
questions on a teacher's test has the same gap as one who failed them in
practice, and the app would be worse for ignoring it.

Rules:

- The **suggestion** may cite both:
  *"Cash Flow — 6 practice mistakes, and 4 wrong on the 14 Aug test."*
- The **recovery session** may include questions targeting both.
- **The private analysis screen shows practice only.** School data appears in the
  student's school-facing screens, where the teacher and parent also see it.
- **Nothing about practice ever flows the other way.** No teacher, parent or
  principal view gains anything from this, ever.

This is a deliberate asymmetry: private data may inform the student's own
suggestions; it never leaves.

---

## 9. Notifications

Locked decision: students get notified about pending recovery and revision.

- **Recovery due:** once, when the trigger fires. **Not repeated.**
- **Revision due:** once on the due date, once again after 7 days overdue, then
  silent. It remains visible in analysis.
- **Daily practice reminder** is separate (§10.12) and switchable off.

**Never more than one recovery or revision notification a day**, regardless of how
many chapters qualify. Batch them: *"3 chapters need review."* Nagging is how a
paid feature gets muted.

---

## 10. Constants — one module, tunable in one place

```
RECOVERY_TRIGGER_COUNT      = 5      // open mistakes before building
GENERATION_TARGET_SECONDS   = 120    // build time target; degrade by taking
                                     // longer, never by failing
GENERATION_MAX_RETRIES      = 5      // background, invisible to the student
REMINDER_MAX_PER_DAY        = 1      // batched across chapters, stops on start
RECOVERY_GENERATION_ROUNDS  = 3      // fresh questions added in rounds 1-3;
                                     // round 4+ draws from the accumulated pool

RECOVERY_TIER0              = 2      // the original wrong questions
RECOVERY_TIER1              = 3      // AI variants, different values
RECOVERY_TIER2              = 3      // AI variants, different framing
RECOVERY_TIER3              = 2      // same topic, different application
                                     // 10 questions per session

RECOVERY_PROCEDURAL_THRESHOLD = 0.80  // tiers 0 and 1
RECOVERY_CONCEPTUAL_THRESHOLD = 0.70  // tiers 2 and 3

REVISION_INTERVALS          = [7, 21, 60]   // days
REVISION_ENGAGEMENT_MIN     = 10     // questions in a chapter that start the clock
REVISION_COUNT              = 8      // fresh questions per check
REVISION_PASS_THRESHOLD     = 0.70
REVISION_STAGES_TO_SOLID    = 3

VARIANT_CACHE_FIRST         = true   // always check the bank before generating

TREND_MIN_SESSIONS          = 4      // before any trend is declared
TREND_DELTA_POINTS          = 10     // accuracy change that counts as movement
REPEATED_MISTAKE_PIN        = 3      // times_wrong that pins a chapter to top
```

**Every one of these is a judgment, not a law.** They are defensible starting
points; they should be reviewed once there is real usage data. **No component
may contain any of these as a literal.**

---

## 11. Worked example

Ravi, Class 12 Accountancy, chapter *Cash Flow Statement*.

**Day 1** — 20-question session. 6 wrong, 2 skipped.
`practice_mistakes` gains 6 rows. `chapter_tally` gains one row: attempted 20,
correct 14. `chapter_state` → `has_mistakes`.
6 ≥ 5, but only minutes have passed — **no suggestion yet.**

**Day 2** — cooldown met. App suggests recovery.

**Day 2, recovery session.** Ten questions on the ladder. The bank already holds
two Tier-1 variants of one of his wrong questions, generated for another student
last term — those are served free. The rest are generated.

```
Tier 0  original          2/2  ✓
Tier 1  different values  3/3  ✓     procedural = 5/5 = 1.00 ✓
Tier 2  different framing 1/3  ✗
Tier 3  different use     1/2  ✗     conceptual = 2/5 = 0.40 ✗
```

→ **NOT READY**

Report: *"You handled the calculations perfectly — every question that worked
like the original. But when the same idea was asked differently, 2 of 5. That
usually means the steps are solid and the concept underneath isn't yet."*

That is a diagnosis, not a score. A single 70% would have hidden it completely.

Ravi clears anyway. Extra confirm. `last_recovery_readiness = 0.58` stored.
`chapter_state` → `recovered`, `next_revision_at` = day 9, stage 1.

**Day 9 — revision.** 8 fresh questions. 4 correct = 0.50, below 0.70.
**FAILED.** 4 new mistake rows. Previously cleared rows stay cleared.
`chapter_state` → `revision_failed`, stage 0. Pinned to the top of analysis.

Analysis now reads: *"Cash Flow Statement — 4 open, cleared 7 days ago at 58%
readiness, failed revision."* Every part of that is true and actionable, and it
was reached without ever blocking him.

**Day 11 — second recovery.** Procedural 5/5, conceptual 4/5 = 0.80 ✓ →
**READY.** Cleared with the app agreeing.

**Day 18 — revision.** 7/8 = 0.875. **PASS.** Stage 2, next check day 39.
**Day 39** — pass. Stage 3, next check day 99.
**Day 99** — pass. **Solid.** Leaves the queue.

Five months, six sessions, and the difference between "cleared it" and "actually
knows it" is visible at every step.

---

## 12. Still open

- **XP for recovery and revision.** Should clearing a chapter earn XP? If it
  does, it becomes farmable — a student clears prematurely for points. My
  recommendation: **XP for questions answered correctly only**, never for
  clearing or passing. Effort is rewarded; self-certification is not.
- **RESOLVED** — recovery uses AI variants of the student's own wrong questions,
  laddered by transfer distance (§4.2). Bank first, generate on miss, and every
  variant is saved back so the cache warms over time.
- **Topic-level triggering**, once picked topics accumulate (§10.22). The rules
  above apply unchanged one level down — no rebuild.
