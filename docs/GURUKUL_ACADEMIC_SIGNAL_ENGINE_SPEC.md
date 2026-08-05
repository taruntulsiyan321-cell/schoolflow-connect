# The Gurukul Academic Signal Engine

**A design specification. No code, no SQL, no schema, no implementation. This document is the canonical reference from which implementation will later be built.**

Status: draft v1 — for review before any implementation work begins.

---

## 1. Vision

Every academic module Gurukul will ever build — Practice, Weak Areas, Strong Areas, Recovery, Revision Planner, Nova, Parent/Teacher/Principal Analytics, Reports, Ranking, adaptive practice, future AI tutors — needs to answer some version of the same question: *what does this student's history with this piece of knowledge actually look like?*

Today, and in every version of this codebase that has existed so far, that question gets answered independently, ad hoc, inside each module. One module computes a weighted mastery score. Another reads raw attempt counts. A third derives its own "weak concept" list with its own thresholds. When two modules disagree — and they will, because they were never the same computation — nobody can say which one is right, because neither was ever *the* source of truth. This session's own work stabilizing the Practice module surfaced this exact failure mode more than once: two implementations of a feature, one of them silently dead; a legacy dataset and a new one both claiming to represent "the mistake book."

The Academic Signal Engine exists to end that pattern permanently, not just inside Practice, but for every module that will ever be built on top of student academic behavior.

It has exactly one job: **observe what a student did, and record honest, interpretation-free facts about it.** It does not decide who is weak. It does not decide who is strong. It does not decide what a teacher should see or what a student should be told. Those are judgments, and judgments belong to the modules that consume this engine's facts — each of which is allowed, and expected, to interpret the same facts differently, for its own purpose.

If this document is right, Gurukul gets ten years of new modules built on a foundation that never needs to be re-derived. If it is wrong, every module built on it inherits the mistake.

---

## 2. Design Philosophy

**One producer of facts, unlimited interpreters.** The engine writes. Every module reads. No module — not even a well-intentioned one — computes its own version of a fact this engine already owns.

**Facts, not verdicts.** "47 correct out of 60 attempts, most recently 4 days ago, at growing intervals between reviews" is a fact. "Weak" is Weak Areas' opinion about that fact, formed with its own threshold, which Recovery is free to disagree with using a different threshold, because Recovery is solving a different problem (which concepts need remediation *right now*) than Weak Areas is (which concepts should be highlighted on a dashboard).

**Evidence has weight.** A student who answered one question correctly is not "100% accurate" in any meaningful sense — they are one data point away from also being 0% accurate. Every signal that summarizes performance must travel with a signal that says how much to trust it. This is not optional polish; it is the difference between an engine that measures learning and one that measures noise.

**Nothing is deleted, nothing is retroactively rewritten.** The raw record of what happened is permanent. Rollups and derived scores can be recomputed, re-modeled, and improved for the next ten years without ever touching the raw layer, because the raw layer is the only thing that can never be reconstructed once lost.

**Don't collapse what you can't uncollapse.** A single "mastery score" per concept destroys information the moment it's written — was it high because the student is confident and consistent, or because they got lucky on three questions? Once collapsed into one number, that distinction is gone forever. Keep the components. Let consumers combine them if they want a single number; never hand them only the combination.

**Design for the graph you have, not the tree you wish you had.** Real curricula are not strictly hierarchical. A question can belong to more than one concept. A concept can span more than one chapter. The engine has to be honest about that instead of forcing a clean tree that will break the first time a cross-cutting concept shows up.

**Build the measurement layer once. Let the models on top of it change forever.** Bayesian Knowledge Tracing, Item Response Theory, Deep Knowledge Tracing — these are all *interpretations* of the same underlying event stream (a student attempted an item, took some time, got it right or wrong). The engine's job is to make that event stream complete and honest enough that any of these models — including ones that don't exist yet — can be trained or computed from it later without re-instrumenting anything.

---

## 3. Core Principles

1. **Single ingestion path.** Every academic attempt — from Practice, DPP, Battleground, Homework, Recovery, Revision, or a future module — flows through one event-recording contract. Not five modules each writing their own version of "the student answered a question."
2. **Raw layer is append-only and immutable.** Corrections are new events, never edits to old ones.
3. **Aggregates are incremental, never full-history recomputations.** At 100 million attempts, "recompute from scratch" is not a strategy, it's an outage.
4. **Every summary signal carries a confidence signal.** No exceptions. A count-of-1 accuracy and a count-of-200 accuracy must never look the same to a consumer that doesn't check evidence.
5. **Immutable facts about a question (subject, board, class) are never copied onto a student's record. Facts about *the student's relationship to the question* (their status, their attempt history) are.** This mirrors, and generalizes, a rule this codebase already learned the hard way in the Practice Engine: duplicate immutable data and it drifts the moment the source is corrected.
6. **Consumers own thresholds. The engine owns evidence.** "Needs revision now" is a threshold applied to a retention estimate. The engine stores and updates the retention estimate. It never stores "needs revision now."
7. **Everything is versioned.** A model version, a formula version, a threshold version. When the math changes — and per Principle 8, it will — old computed values must be distinguishable from new ones, not silently overwritten as if they were always right.
8. **Assume the formulas will be wrong and get replaced.** Today's mastery estimate is Classical-Test-Theory-simple. In two years it might be a proper Bayesian Knowledge Tracing model. In five, a trained sequence model. The raw layer must be rich enough that none of those upgrades require re-instrumenting the product — only re-running a job over history that was never thrown away.

---

## 4. Signal Taxonomy — How to Read the Rest of This Document

Every signal below is one of five kinds. This classification is used consistently, and it is itself the answer to the "Storage Design" section of the brief:

| Kind | What it is | Example | Persisted? |
|---|---|---|---|
| **Raw fact** | An immutable record of something that happened | "user X attempted question Y at time T, selected option 2, took 4300ms" | Yes, forever, append-only |
| **Aggregated fact** | An incrementally-maintained roll-up over raw facts | `attempt_count`, `correct_count` for (student, concept) | Yes, updated incrementally |
| **Derived fact** | Computed on read from aggregated facts via a pure formula | `accuracy = correct_count / attempt_count` | No — computed at query time |
| **Cached fact** | An expensive derived fact, recomputed on a schedule, not on read | item discrimination index, cross-population percentile | Yes, with `computed_at` + explicit staleness |
| **Runtime-only fact** | Never persisted at all | live in-session streak counter, current-request IRT re-estimate | No |

Every signal table below carries these columns: **Signal · Kind · Formula / Definition · Why It Exists · Update Frequency · Owner (producer) · Consumers · Storage Class**. "Storage Class" repeats the taxonomy above so each signal's persistence is unambiguous without cross-referencing.

---

## 5. The Dependency Graph

The brief's example graph (Question → Concept → Topic → Chapter → Subject → Student) is *mostly* right, but treating it as a strict tree is the first mistake this design refuses to make. The real graph has two axes:

```
                    ┌─────────────────────────────┐
                    │   QUESTION-ITEM AXIS         │
                    │   (population-level,          │
                    │    not student-specific)       │
                    │                                │
                    │   Question ── item quality,     │
                    │              empirical           │
                    │              difficulty,          │
                    │              discrimination         │
                    └───────────────┬────────────────┘
                                    │ tagged with (many-to-many)
                                    ▼
STUDENT-VERTICAL AXIS:        Concept(s)
(everything below is             │  aggregates up, weighted-full-credit
 per-student)                    │  per tagged concept (§13.1)
                                  ▼
                                Topic
                                  │  aggregates up (§9)
                                  ▼
                                Chapter
                                  │  aggregates up (§9)
                                  ▼
                                Subject
                                  │  aggregates up (§9)
                                  ▼
                                Student
```

A **Question** sits at the intersection of both axes. On the *item axis*, it has population-level quality signals (§10) computed from every student who ever attempted it, owned by the Signal Engine's calibration job, consumed by content-quality tooling. On the *student-vertical axis*, each (student, question) pair has its own history (§8), which rolls up through concept → topic → chapter → subject → student for that one student.

**Nothing skips a layer without a reason.** The one deliberate exception: a question may be tagged to more than one concept (§13.1 explains the rule for that). No other skip is permitted — a chapter-level signal is always derived from its topics, never computed directly from raw attempts, because that would create two independent paths to the same number that can silently disagree.

---

## 6. What The Engine Does Not Redesign

Per the brief: question metadata (class, subject, chapter, topic, subtopic, difficulty, question type, board, stream, concept(s), learning outcome, Bloom level, marks, estimated time) is treated as a given input, not something this engine redefines. Two things about it matter enough to call out explicitly, because they affect the signal design below:

- **Author-assigned "difficulty" and empirically-measured difficulty are different signals and must never be merged into one column.** A question tagged "Hard" by a teacher that 90% of students answer correctly is *not* hard — it's mistagged, or it's a great teaching question, or both. The engine tracks both and never lets one silently overwrite the other (§10).
- **Concept tagging can change after questions have already been answered.** A question re-tagged from Concept A to Concept B six months after 10,000 students answered it must not retroactively move those 10,000 historical attempts to Concept B — that would corrupt every trend signal that already existed for Concept A. The raw event snapshots the concept tag *as it was at attempt time* (§17, Edge Cases).

---

## 7. Confidence of Measurement — Read This Section First

This is placed early because it is not one signal among many — it is a property every accuracy-like signal in this document must carry, and getting it wrong biases everything downstream.

**The problem, stated precisely:** a student who answers one question correctly has an observed accuracy of 100%. A student who answers 200 questions with 140 correct has an observed accuracy of 70%. A system that only stores the ratio treats the first student as more accurate than the second. That is wrong, and it is wrong in a way that actively rewards students for attempting fewer questions — the worst possible incentive to build into a learning product.

**What the literature actually recommends, and what this design borrows:**

- The **Wilson score interval** (Wilson, 1927) is the standard correction for small-sample binomial proportions — it shrinks the estimate toward 50% and widens the interval as sample size shrinks, and it has well-documented superior coverage over the naive Wald interval especially near 0% or 100% observed accuracy.
- The **Jeffreys interval** (Beta(½, ½) prior) is the Bayesian sibling of Wilson and performs at least as well in the smallest samples (n as low as a handful of attempts), which matters enormously here — a student's first attempt at a brand-new concept is exactly the n=1 case this whole section exists for.
- **Beta-Binomial shrinkage** (equivalent in spirit to a Bayesian-average / "IMDB rating" style formula) is the practical, cheap-to-compute-incrementally version of the same idea: blend the observed ratio with a population prior, weighted by how much evidence exists.

**What this design does with it:**

Every concept-level (and topic/chapter/subject/student-level) accuracy-like signal has a paired **`measurement_confidence`** signal, defined as the width of the Wilson (or Jeffreys, for very small n) 95% confidence interval around the observed accuracy, inverted to a 0–1 scale (narrow interval → confidence near 1; wide interval → confidence near 0). A `raw_accuracy` of 100% with `measurement_confidence` of 0.08 (n=1) is a completely different fact from a `raw_accuracy` of 100% with `measurement_confidence` of 0.94 (n=60), and every consumer of accuracy **must** read both.

For the cheap, per-attempt incremental version (Wilson requires a normal approximation that is fine to compute at read time from `correct_count`/`attempt_count`, so no special storage is needed — this is a **derived fact**, not a stored one):

> `measurement_confidence = 1 − wilson_interval_width(correct_count, attempt_count, z=1.96)`

**Worked example, matching the brief's own scenario:** 1 question, 1 correct. Wilson center ≈ 0.79 (already pulled well below the naive 100%), interval width ≈ 0.75 wide → `measurement_confidence ≈ 0.25`. Compare to 60 correct of 60 attempts: Wilson center ≈ 0.94, interval width ≈ 0.09 → `measurement_confidence ≈ 0.91`. This is exactly the behavior the brief asked for, and it costs nothing extra to store — it's computed from two integers every consumer already has.

**Sources:** [Wilson CI — Statistics How To](https://www.statisticshowto.com/wilson-ci/), [Comparing Methods for Estimating 95% Confidence Intervals of Proportions](https://davidzhao1015.github.io/blog/2025/benchmark-interval-prop/).

---

## 8. Student × Question Signals

Per (student, question) pair — the leaf of the student-vertical axis, and the *only* place raw individual attempts are ever stored directly. Every layer above this is a rollup; nothing above this layer stores anything that could instead be derived from here plus §10.

| Signal | Kind | Definition | Why | Update | Owner | Consumers | Storage |
|---|---|---|---|---|---|---|---|
| `attempt_event` (one row per attempt) | Raw | student, question, session, selected_option, correct_option_at_attempt_time, is_correct, is_skipped, time_taken_ms, hint_used, solution_viewed_before_answer, concept_tags_at_attempt_time, difficulty_tag_at_attempt_time, source_module, answered_at | The one thing that can never be reconstructed if lost. Every other signal in this document is derivable from a complete stream of these. | Every attempt, synchronously | Whichever module recorded the attempt (Practice, DPP, Battleground, Homework, Recovery, Revision), through the single shared ingestion contract (§14) | Nothing reads this directly except the aggregation job — modules read rollups, never raw events, except audit/debug tooling and future model (re)training | Raw |
| `attempt_count`, `correct_count`, `wrong_count`, `skip_count` | Aggregated | Running counters | The base of every accuracy-like derived fact | Every attempt, incremental (`+1`) | Signal Engine aggregation | Every module that reads this question's status for this student | Aggregated |
| `current_status` | Aggregated | Outcome of the *most recent* attempt: correct / wrong / skipped | The one thing "is this in the Mistake Book / Incorrect Questions / Skipped Questions list" depends on | Every attempt, overwritten | Signal Engine | Practice (Incorrect/Skipped/Mistake lists), Recovery | Aggregated |
| `first_attempted_at`, `last_attempted_at` | Aggregated | Timestamps | Recency, "new to this student" detection | Every attempt | Signal Engine | Practice, Nova (novelty detection) | Aggregated |
| `fastest_time_ms`, `slowest_time_ms`, `total_time_ms` | Aggregated | Running min/max/sum | Base for time signals; avg/median are derived, not stored (see §11 on why median specifically is *not* naively aggregable) | Every attempt | Signal Engine | Time signal consumers | Aggregated |
| `hint_used_count`, `solution_viewed_count` | Aggregated | Counters | Distinguishes "solved independently" from "solved with help" — critical, because these must never silently count toward accuracy the same way | Every attempt | Signal Engine | Nova (hint effectiveness), Practice UI | Aggregated |
| `bookmark_state` | Aggregated (state, not event) | Currently bookmarked: true/false | Student intent signal, permanent until toggled off | On toggle | Practice (student action) | Practice (Bookmarked Questions) | Aggregated |
| `bookmark_toggle_count` | Aggregated | How many times bookmarked/unbookmarked | Weak but real signal of indecision or re-engagement; **do not over-interpret** — see §15 for why this is deliberately *not* promoted to a stronger signal | On toggle | Signal Engine | Nova (low weight), content-quality tooling | Aggregated |
| `review_count` | Aggregated | Times viewed post-answer without a new attempt (e.g. revisited via History) | Distinguishes passive review from active retrieval practice — these are pedagogically different and retrieval practice research says only the latter reliably strengthens memory | Per view event | Signal Engine | Nova, Revision Planner | Aggregated |
| `accuracy` | Derived | `correct_count / attempt_count` | — | On read | — | Everyone, always paired with `measurement_confidence` (§7) | Derived |
| `avg_time_ms` | Derived | `total_time_ms / attempt_count` | — | On read | — | Time consumers | Derived |
| `is_new_to_student` | Derived | `attempt_count == 0` | Gates "never seen before" UI/logic | On read | — | Practice, adaptive selection | Derived |

**Explicitly excluded from this layer:** a stored `guess_probability` per attempt. See §15.4 for the argument against it — the short version is that whether an answer was "a guess" is not directly observable, and manufacturing a binary flag for it would be a judgment, not a fact.

---

## 9. Concept-Level Signals — The Core of the Engine

This is where the brief is right that "everything eventually becomes concept intelligence." Concept is the layer every other academic module actually cares about — nobody asks "is this student weak at *Question #4821*," they ask "is this student weak at *quadratic equations*."

### 9.1 Aggregated Facts (rolled up from every attempt tagged to this concept)

| Signal | Definition | Why | Update | Owner |
|---|---|---|---|---|
| `attempts_total`, `correct_total`, `wrong_total`, `skipped_total` | Sums across all attempts on questions tagged to this concept | Base counters | Per attempt | Signal Engine |
| `distinct_questions_attempted` | Count of *unique* questions attempted, not just attempt count | 10 attempts on 1 question is not the same evidence as 10 attempts on 10 questions — breadth matters and must not be conflated with volume | Per attempt (set insert) | Signal Engine |
| `first_practiced_at`, `last_practiced_at` | Timestamps | Recency | Per attempt | Signal Engine |
| `total_time_ms`, `time_histogram_bucket_counts` | Sum + a small fixed set of time buckets (e.g. <5s, 5–15s, 15–30s, 30–60s, 60s+) | Median/percentile time is **not** correctly computable from sum and count alone (this is exactly the "what should never aggregate" trap) — a coarse histogram lets us derive an approximate median/percentile at read time without storing every raw timestamp again | Per attempt (bucket increment) | Signal Engine |
| `outcome_sequence` (bounded ring buffer, e.g. last 20 outcomes) | Ordered list of recent correct/wrong/skip | Base for stability, streak, and volatility signals (§9.4) — a summary statistic alone cannot distinguish C-W-C-W-C-W from C-C-C-C-C-W, and the brief is explicit that this distinction matters | Per attempt (push, evict oldest) | Signal Engine |
| `accuracy_by_difficulty` (map: easy/medium/hard/very_hard → correct/attempted) | Difficulty-stratified counters | See §10 — collapsing across difficulty hides exactly the profile ("fine on easy, collapses on hard") that matters most for diagnosis | Per attempt | Signal Engine |

### 9.2 Mastery Signals

| Signal | Kind | Definition | Why | Update | Owner | Consumers |
|---|---|---|---|---|---|---|
| `raw_accuracy` | Derived | `correct_total / attempts_total` | The Classical-Test-Theory baseline — simple, always available, always paired with `measurement_confidence` | On read | — | Weak Areas (v1), Analytics |
| `measurement_confidence` | Derived | Wilson-interval-based, per §7 | Prevents the n=1 problem everywhere | On read | — | Everyone consuming any accuracy signal |
| `mastery_probability` (P(L)) | Aggregated, model output | Bayesian Knowledge Tracing posterior probability the concept is "known," updated per attempt via the standard BKT Bayes-rule update (below) | `raw_accuracy` conflates *knowing* with *guessing* and *slipping*. BKT explicitly separates them: a student can know a concept and still slip (careless wrong answer), or not know it and still guess correctly. Over a sequence of attempts, BKT converges to a materially better mastery estimate than a raw ratio, which is why it has been the dominant model in intelligent tutoring systems since Corbett & Anderson (1994). | Per attempt (cheap closed-form Bayes update) | Signal Engine BKT job | Weak Areas (v2+), Nova, adaptive practice |
| `ability_estimate` (θ) | Cached, model output | IRT ability estimate, requires calibrated item parameters (§10) first | True adaptive practice / computerized-adaptive-testing-style question selection eventually wants this, but it is explicitly a **Phase 4** capability (§20) — it depends on item calibration existing first, which depends on enough population data existing | Batch, once item bank is calibrated | Signal Engine calibration job (future) | Future adaptive practice engine |

**BKT update, borrowed directly from the literature, not reinvented:**

Given prior mastery `P(L)`, slip probability `P(S)`, guess probability `P(G)`, and an observed outcome:

> If correct: `P(L | correct) = P(L)·(1−P(S)) / [P(L)·(1−P(S)) + (1−P(L))·P(G)]`
> If incorrect: `P(L | incorrect) = P(L)·P(S) / [P(L)·P(S) + (1−P(L))·(1−P(G))]`
>
> Then apply the learning-transition update: `P(L_next) = P(L | obs) + (1 − P(L | obs))·P(T)`

`P(T)` (transition/learning rate), `P(S)`, `P(G)` start as **population-level priors per concept** (not fit per-student from day one — fitting four free parameters per student per concept from a handful of attempts is a well-documented overfitting trap; individualized BKT variants exist in the research but are explicitly deferred to a later phase, §20). This is a direct, acknowledged borrow from Corbett & Anderson's original BKT formulation, adapted only in that priors are seeded per-concept from population data rather than fixed globally.

**Source:** [Knowledge Inference: Bayesian Knowledge Tracing](https://learninganalytics.upenn.edu/MOOT/slides/W004V002.pdf), [Individualized Bayesian Knowledge Tracing Models](https://www.cs.cmu.edu/~ggordon/yudelson-koedinger-gordon-individualized-bayesian-knowledge-tracing.pdf).

**What this design deliberately does *not* borrow:** Deep Knowledge Tracing (RNN/transformer-based). DKT can model richer patterns than BKT but needs no new raw data beyond what §8 already captures — it is purely a *consumer* of the same event stream, trained separately, and is explicitly placed in Phase 5 (§20) rather than built into the engine itself. The engine's job is to make the event stream complete enough that DKT (or whatever comes after it) can be trained on it later without re-instrumentation — not to embed a specific model architecture into the schema.

### 9.3 Time Signals (Concept-Level)

| Signal | Definition | Why | Update | Owner |
|---|---|---|---|---|
| `avg_time_ms`, `median_time_ms` (approx, from histogram) | Central tendency | Baseline speed | Derived | — |
| `time_on_correct_avg`, `time_on_wrong_avg` | Split by outcome | This split is one of the most diagnostically useful time signals: fast+wrong suggests carelessness or guessing; slow+wrong suggests a genuine misconception; fast+correct suggests real fluency; slow+correct suggests effortful-but-real understanding. A single average time hides all four of these completely different situations. | Derived from bucketed sums | — |
| `speed_trend` | Slope of time-per-attempt over attempt sequence (regression over the ring buffer / recent window) | Grounded in the **power law of practice** (Snoddy 1928, Newell & Rosenbloom) — time-per-attempt should fall roughly log-linearly with practice; deviation from that expected trend is itself informative (a plateaued or worsening speed trend despite continued practice is a distinct signal from accuracy alone) | Derived, recomputed on read from recent window | — |

**What is explicitly excluded here, and why:** a literal "reaction time" signal (time to first keystroke/interaction) and a stored "idle time" per question. See §15.1 and §15.2 for the argument.

**Sources:** [Power law of practice](https://en.wikipedia.org/wiki/Power_law_of_practice), [A Lognormal Model for Response Times on Test Items (van der Linden, 2006)](https://journals.sagepub.com/doi/10.3102/10769986031002181) — the log-normal response-time model is the more statistically correct treatment of solving-time distributions (which are right-skewed, not normal) and is the recommended model *if and when* response-time modeling is formalized into item-level parameters in a later phase; for v1, simple bucketed histograms are sufficient and far cheaper.

### 9.4 Stability & Consistency Signals

| Signal | Definition | Why | Update | Owner |
|---|---|---|---|---|
| `current_streak`, `longest_correct_streak`, `longest_wrong_streak` | Derived from `outcome_sequence` | Directly answers the brief's C-W-C-W-C-W vs C-C-C-C-C-W example | Derived on read | — |
| `volatility_index` | Sign-change count in `outcome_sequence` window ÷ window size | High = oscillating performance (unstable understanding, possibly guessing); low = consistent streaks (stable, whether stably-good or stably-bad) | Derived on read | — |
| `consistency[dimension]` | A **reusable statistical pattern**, not N bespoke signals: coefficient of variation of accuracy across a partition dimension (difficulty, day-of-week, time-of-day, session, question-type, board) | The brief asks for consistency across seven different dimensions. Hand-designing seven separate signals is exactly the kind of design that breaks in year 3 when an eighth dimension (e.g. "device type" or a new exam board) needs to be added. Instead, consistency is defined once as a function `consistency(metric, partition_dimension)` applied to whichever dimension a consumer needs — new dimensions require no schema change, only a new partition key at query time. | Derived on read (from partitioned aggregates already being maintained per §9.1) | — |

### 9.5 Difficulty Signals

| Signal | Definition | Why | Update | Owner |
|---|---|---|---|---|
| `accuracy_by_difficulty` | From §9.1's map | The core diagnostic: is the student failing everything equally, or failing specifically at high difficulty? These require completely different interventions. | Per attempt | Signal Engine |
| `difficulty_gap` | `accuracy(easy) − accuracy(hard)` | A single scalar summary of the above, useful for sorting/ranking concepts by "cliff steepness" — but always exposed alongside the full map, never instead of it, per the "don't collapse what you can't uncollapse" principle | Derived | — |
| `performance_vs_expected` | (Phase 4+, requires IRT calibration) Observed accuracy vs. theoretically expected accuracy at the student's ability estimate | A residual signal — over- or under-performing relative to a calibrated expectation is more informative than raw accuracy alone, but explicitly deferred until item calibration exists | Derived, Phase 4 | — |

### 9.6 Retention & Forgetting Signals

| Signal | Kind | Definition | Why | Update | Owner |
|---|---|---|---|---|---|
| `half_life_estimate` | Aggregated, model output | A per-(student, concept) memory half-life, in days, updated via a Duolingo-style Half-Life-Regression-inspired heuristic: successful spaced recall multiplies the half-life up; a forgetting event resets it down | Grounds retention in an *exponential forgetting curve* (Ebbinghaus), the standard model, rather than a linear or arbitrary decay | On each attempt where the concept was previously "known" (i.e., a recall event, not a first-learning event) | Signal Engine |
| `retention_estimate` (current recall probability) | **Derived, never stored** | `2^(−days_since_last_practice / half_life_estimate)` | This must be computed at query time, not stored, because it decays continuously even when the student does nothing — a stored snapshot would be stale the moment it's read | On read | — |
| `forgetting_events_count` | Aggregated | Count of times a concept previously at `current_status = correct` was later answered wrong | The direct, observable definition of "forgot," distinct from "never learned" | Per attempt | Signal Engine |
| `relearning_speed` | Aggregated | Attempts needed to return to prior mastery level after a forgetting event | Distinguishes a quick "oh right, I remember now" from a genuine re-learn-from-scratch | Per forgetting-event resolution | Signal Engine |
| `days_until_retention_below(x)` | **Derived function, parameterized, never stored** | Solve `2^(−d/half_life) = x` for `d` | This is the correct answer to the brief's Revision Signals ask ("needs revision soon") — it is a *function*, not a stored category, because "soon" is a threshold every consumer (Revision Planner vs. an anxious parent dashboard vs. Nova) may define differently | On read, parameterized by caller | — |

**Sources:** [Adaptive Forgetting Curves for Spaced Repetition Language Learning](https://arxiv.org/pdf/2004.11327), [Duolingo Half-Life Regression](https://research.duolingo.com/papers/settles.acl16.pdf), [SM-2 Algorithm](https://super-memory.com/english/ol/sm2.htm). This design borrows the *exponential decay with a fitted, personalized half-life* idea from both HLR and SM-2, but does not adopt SM-2's discrete quality-rating scale (0–5 self-reported "how hard was recall") — this product has no self-report step, so half-life updates are derived purely from observed correct/wrong/time, which is closer in spirit to HLR (fit from behavioral data) than SM-2 (fit from self-report).

### 9.7 Recovery Signals

| Signal | Definition | Why | Update | Owner | Consumers |
|---|---|---|---|---|---|
| `recovery_attempts_count`, `recovery_success_count`, `recovery_failure_count` | Counters, scoped to attempts explicitly made through a recovery/remediation flow | Distinguishes "got it right eventually, unprompted" from "got it right after targeted intervention" — pedagogically different events | Per recovery attempt | Recovery module (as producer, through the shared ingestion path) |
| `repeated_recovery_count` | Times this concept has entered recovery more than once | A single recovery cycle failing to stick is a much stronger signal than the first failure alone | Per new recovery cycle | Signal Engine |
| `recovery_efficiency` | Derived: `recovery_success_count / recovery_attempts_count` | — | Derived | — |
| `post_recovery_retention` | Accuracy on this concept in a fixed follow-up window (e.g. 14/30 days) after the most recent successful recovery | The real test of whether recovery worked isn't the recovery session itself, it's whether the concept stayed learned | Computed on a schedule (batch), since it requires a future time window to have passed | Signal Engine batch job |

### 9.8 Trend Signals

| Signal | Definition | Why | Update |
|---|---|---|---|
| `recent_accuracy_ewma`, `historical_accuracy_ewma` | Exponentially-weighted moving averages over recent vs. all-time attempts | Two EWMAs at different decay rates, compared, is a robust and standard way to detect trend direction without the whiplash a naive "last 5 vs previous 5" window comparison produces on small samples | Derived on read (from the outcome sequence + longer aggregate) |
| `trend_delta` | `recent_accuracy_ewma − historical_accuracy_ewma` | The single number a consumer would threshold to call something "improving" or "declining" — **the engine stores/derives the delta, never the label** | Derived |

Explicitly, `is_improving`, `is_declining`, `is_plateaued` are **not signals this engine produces**. They are Weak Areas' (or Nova's, or a teacher dashboard's) interpretation of `trend_delta` against a threshold that module owns.

---

## 10. Question-Item Quality Signals (Population Axis)

These are properties of the *question*, aggregated across every student who ever attempted it — not a student-specific signal at all. This is the "item calibration" layer that IRT and classical item analysis both depend on.

| Signal | Kind | Definition | Why | Update | Owner | Consumers |
|---|---|---|---|---|---|---|
| `population_attempt_count`, `population_correct_count` | Aggregated | Same shape as §8, but summed across all students | Base for everything below | Per attempt, any student | Signal Engine |
| `empirical_difficulty` | Derived/Cached | `1 − (population_correct_count / population_attempt_count)`, or in IRT terms the calibrated `b` parameter once enough data exists for a proper 2PL fit | The **author-assigned difficulty tag and this signal are kept as two separate, never-merged fields** — see §6. Divergence between them (an "Easy"-tagged question with 30% empirical accuracy) is itself a content-quality alert. | Batch (needs a meaningful sample, not per-attempt) | Signal Engine calibration job |
| `discrimination_index` | Cached | Point-biserial correlation between getting this item right and overall performance on the surrounding assessment | The standard psychometric measure of "does this question actually separate students who understand the concept from those who don't" — a well-known item analysis technique. A very-low or negative discrimination index flags a broken, ambiguous, or mistagged question. | Batch, requires a real sample | Signal Engine calibration job | Content-quality tooling, question authors |
| `abnormal_wrong_rate_flag` | Cached | Statistical outlier flag: empirical difficulty far outside the distribution of its peers (same concept, same author-tagged difficulty) | Surfaces likely-broken questions without a human needing to review every item manually | Batch | Signal Engine | Content-quality tooling |
| `abnormal_fast_wrong_flag` | Cached | Unusually high rate of *fast* wrong answers (wrong, but well below median time-on-item) | A distinct failure mode from "too hard" — this pattern suggests students recognize the question as flawed/ambiguous and disengage quickly, or a correct-option-key error | Batch | Signal Engine | Content-quality tooling |
| `skip_rate` | Aggregated/Derived | Fraction of encounters that end in skip rather than an answer | High skip rate on an easy-tagged question is itself informative (confusing wording, UI issue) | Per encounter | Signal Engine |
| `bookmark_rate` | Aggregated/Derived | Fraction of students who bookmark this question | **Deliberately ambiguous, and flagged as such rather than resolved** — a high bookmark rate could mean "important, want to revisit" or "confusing, marking to ask about later." The engine does not resolve this ambiguity; it exposes the raw rate and lets a consumer with more context (e.g. correlating with `abnormal_wrong_rate_flag`) interpret it. | Per toggle | Signal Engine |
| `reported_issue_count` | Aggregated | Explicit user reports (if/when such a feature exists) | Direct human signal, highest trust, lowest volume | On report | Whatever module owns issue reporting |

**Source:** [Point-biserial correlation for item discrimination](https://assess.com/the-point-biserial-item-discrimination/), [Item analysis: distractor efficiency and difficulty/discrimination](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11040895/).

---

## 11. Topic / Chapter / Subject Aggregation Rules

This section exists because the brief specifically asks "what should aggregate, what should never aggregate" — and getting this wrong is one of the most common, least-noticed bugs in analytics systems (a version of Simpson's Paradox: averaging averages across groups of different sizes produces numbers that don't correspond to any real underlying rate).

**Rule: counts sum. Ratios never average — they re-derive from summed counts.**

| What | Correct approach | Wrong approach (do not do this) |
|---|---|---|
| Topic accuracy | Sum `correct_total` and `attempts_total` across every concept in the topic, then divide | Average the per-concept accuracy percentages |
| Topic `measurement_confidence` | Recompute Wilson interval from the *summed* counts | Average the per-concept confidence values |
| Topic `mastery_probability` | **Not** a simple average either — a topic's mastery is better represented as the *distribution* of its concepts' mastery (e.g., "3 of 5 concepts above 0.8, 2 below 0.4") than collapsed into one number. If a single scalar is genuinely needed, a confidence-weighted average (weight each concept's `mastery_probability` by its `measurement_confidence`) is defensible; an unweighted average is not. | Unweighted mean of concept mastery probabilities |
| Topic `retention_estimate` | Not a scalar at all by default — expose the **set of concepts with `retention_estimate` below a caller-supplied threshold** (Revision Planner wants this list, not a single "topic retention score") | A single averaged retention number that hides which specific concepts are actually at risk |
| Topic time signals | Sum the histogram buckets across concepts, then derive median/percentile from the combined histogram | Average the per-concept averages (loses the underlying distribution shape entirely) |
| Chapter, Subject | Same rules, one layer further out — chapter aggregates from topics, subject from chapters. **Never compute a chapter or subject number directly from raw attempts**, even though it would give the same *count*-based answer, because it creates a second computation path that can silently diverge from the topic-level one during a future model change. | Any direct raw-attempt-to-chapter/subject computation that bypasses the topic layer |

**What should never aggregate at all, at any layer:** `outcome_sequence` (a chapter-level "outcome sequence" is meaningless — sequences belong to a specific concept's specific ordered history), `half_life_estimate` (a chapter doesn't forget, its component concepts do, independently and at different rates), `bookmark_state` (binary per-question state has no sensible topic-level rollup beyond a count).

---

## 12. Student-Level Signals

The brief is explicit: *"Not percentages. Actual educational intelligence."* The student level is where a single scalar is least appropriate and a *profile* is most valuable.

| Signal | Definition | Why |
|---|---|---|
| `concept_maturity_distribution` | Histogram: count of concepts in each maturity band (defined by combining `mastery_probability` × `measurement_confidence` × `retention_estimate` into bands — see §13.2's warning about composites) | A student with 40 "mature" concepts and 5 "shaky" ones is a completely different case from one with 10 mature and 35 unmeasured — a single average GPA-style number erases that difference entirely |
| `practice_regularity` | Coefficient of variation of the gaps between practice days | Distinguishes a student who studies consistently every 2 days from one who cram-bursts once a month then vanishes — same total practice time, very different retention risk profile (§9.6) |
| `breadth_of_coverage` | Distinct concepts with any evidence (`attempts_total > 0`) ÷ total concepts in the student's curriculum scope | Surfaces "hasn't even tried yet" as distinct from "tried and struggling" — these need opposite interventions |
| `response_time_profile` | The concept-level time-on-correct/time-on-wrong split (§9.3), aggregated as a *profile*, not collapsed | Feeds Nova's personalization (§13) — "fast and often wrong" vs. "slow but usually right" are different learners needing different pacing advice |
| `difficulty_profile` | Accuracy-by-difficulty (§9.5), aggregated across the student's whole scope | Same reasoning as concept-level: a cliff at "hard" across the board is a different intervention than uniformly-mediocre performance |
| `bloom_level_profile`, `question_type_profile` | Accuracy/time broken down by Bloom's taxonomy level and by question type (conceptual/calculation/application/word-problem, etc., **if and when** question metadata is extended to carry this tag — see §6 and §13) | This is the single highest-value signal set for Nova and for genuinely personalized tutoring — "always fails application questions, fine on recall" is a real, actionable pattern |
| `overall_trend_delta` | Same EWMA-delta pattern as §9.8, applied across the student's whole scope | — |

**Explicitly not stored here:** a percentile rank, a "percentage complete," a single composite score, or anything resembling a GPA. See §15.7 and §15.8.

---

## 13. Cross-Cutting Sections

### 13.1 Multi-Concept Questions

A question tagged to more than one concept counts as a **full, independent attempt toward each tagged concept** — not split or weighted. This is the deliberately simpler of two options (the alternative, splitting credit proportionally, requires a subjective per-tag weight that is easy to get wrong and hard to justify, and would need re-litigating every time a question's tags change). Full-credit duplication is conservative, auditable, and — importantly — reversible: if weighted splitting is ever wanted later, it can be computed retroactively from the raw event log's `concept_tags_at_attempt_time` array, because that array is never lossy.

### 13.2 The Composite Score Question

The brief's own example asks for a `concept_maturity` idea. This design includes it, but with an explicit warning attached, because it is the single spot in this whole document most likely to quietly turn into the "weak/strong" judgment the entire philosophy exists to avoid:

> `concept_maturity_score = f(mastery_probability, measurement_confidence, retention_estimate)`, exposed only as one convenience field among the full set of components, never as a replacement for them.

Any consumer that reads only `concept_maturity_score` and discards the components has recreated exactly the single-number problem this document argues against. This is called out explicitly so that implementation does not quietly make the composite the *only* thing indexed or exposed in an API, which is the realistic failure mode (the composite is convenient, so it becomes the only thing anyone bothers to read).

### 13.3 AI (Nova) Signals

Nova does not need new signal types — it needs *access* to the full profile signals already defined above (§9, §12), specifically the ones that reveal *pattern*, not just level: `difficulty_profile`, `bloom_level_profile`, `question_type_profile`, `time_on_correct` vs `time_on_wrong` split, `hint_effectiveness` (derived: accuracy on questions where a hint was used vs. not, per concept), and `trend_delta`. The one genuine dependency this creates: question metadata needs a **cognitive-demand tag** (conceptual understanding / calculation / application / word-problem) to make `question_type_profile` meaningful for Bloom-style diagnosis. Per §6, this document does not redesign question classification — it flags this as a likely-necessary future metadata extension, to be scoped separately, not designed here.

---

## 14. Ownership: Producers and Consumers

**One rule governs all producers:** raw attempt facts (§8) are written through exactly one shared ingestion contract, regardless of which module the attempt happened in. Practice, DPP, Battleground, Homework, Recovery, and Revision are all *callers* of that one contract, never independent writers of their own version of "the student answered a question." This generalizes, to the whole engine, the same "one producer" rule this codebase already enforced for Practice specifically.

**Aggregated and derived facts (§9 onward) have exactly one producer: the Signal Engine itself** — a dedicated aggregation/calibration job, not each consuming module recomputing its own rollup. This is the single most important ownership rule in this document, because the alternative — each module computing its own mastery estimate — is precisely the failure mode described in §1.

| Layer | Producer | Consumers |
|---|---|---|
| Raw attempt events | Practice, DPP, Battleground, Homework, Recovery, Revision (via shared contract) | Signal Engine aggregation job only (modules never read raw events directly, except audit/debug tooling and future model training) |
| Student × Question aggregates | Signal Engine (incremental, per-attempt) | Practice (mode queues: Incorrect/Skipped/Bookmarked), Recovery |
| Concept-level aggregates + BKT | Signal Engine (incremental per-attempt + batch calibration) | Practice (Weak Areas source), Recovery, Revision Planner, Nova, Analytics, Reports |
| Item-quality/calibration | Signal Engine batch job | Content-quality tooling, question authors, (future) adaptive practice / IRT ability estimation |
| Topic/Chapter/Subject/Student rollups | Signal Engine (periodic re-aggregation from the concept layer, §16) | Parent Analytics, Teacher Analytics, Principal Analytics, Reports, Academic Ranking |
| Percentile / rank | **Computed at read time only, by the consumer that needs it** (e.g. Ranking), never stored by the Signal Engine | Ranking module |

**Parent, Teacher, and Principal Analytics never read the raw layer or the student×question layer directly.** They read Concept/Topic/Chapter/Subject/Student aggregates only. This is a deliberate architectural boundary, not an oversight: it keeps the raw layer's blast radius small (a bug or breach in the aggregation layer can't leak raw per-question telemetry to a parent dashboard) and keeps those modules' queries cheap regardless of how many raw events exist underneath.

---

## 15. What Should Never Be Stored

Mandatory section, per the brief. Each entry below is something plausible-sounding — several drawn directly from the brief's own example lists — that this design deliberately excludes, with the argument for why.

### 15.1 Literal "reaction time"

The brief's own Time Signals example list includes "reaction time." This design argues against storing it as a distinct signal. Reaction time, as the term is used in cognitive psychology, describes latency in a continuous-stimulus task (press a key the instant a light appears). This product has no such task — a student reads a question, thinks, then selects an answer. "Time to first interaction" already exists as `time_taken_ms` (§8). A separate "reaction time" signal would either duplicate that field under a different name, or imply a precision about raw reflexes that a multiple-choice quiz UI cannot actually measure. Excluded as redundant with existing time signals, not because time-to-answer is unimportant.

### 15.2 Raw, uncapped idle time

Also from the brief's own list. Idle time (tab blurred, no interaction) is dominated by non-pedagogical noise — a bathroom break, a notification, a distraction — with a very low signal-to-noise ratio for anything academic. Storing it precisely and feeding it into speed-trend signals uncapped means a single 20-minute break corrupts that concept's speed trend for the whole session. Recommendation: cap/clip total time at a reasonable ceiling (e.g. 10 minutes) before it enters any time-based aggregate; beyond that, treat it as "session paused," not "slow thinking." The raw, uncapped value need not be persisted at all.

### 15.3 A single unified "engagement score"

Collapsing practice frequency, session length, streaks, and login frequency into one opaque "engagement" number is exactly the premature-collapse mistake §13.2 warns about, applied to a different axis. "Engagement" means something different to a teacher (is homework being done), a parent (is my child spending a healthy amount of time), and an AI tutor (when is the best moment to nudge). Keep the components (`practice_regularity`, session counts, streaks) separate; let each consumer combine them for its own purpose.

### 15.4 A stored `guess_probability` per attempt

The brief's own Question-Level example list includes this. This design pushes back on it specifically: whether a given correct answer was "a guess" is not directly observable — it is an inference, and storing a binary flag for it manufactures false certainty about the student's mental state at the moment of the attempt. What *is* observable and should be stored is the underlying evidence: `time_taken_ms` relative to the concept's typical time, the question's `empirical_difficulty`, whether the selected option was changed before submission (if the UI ever captures that). Let each consumer (BKT's own `P(guess)` parameter, Nova, a future anti-cheating system) form its own guess-likelihood estimate from that evidence, rather than the engine asserting one interpretation as fact for everyone. This is the same principle as "don't store weak/strong," applied one layer more subtly.

### 15.5 Verdicts and labels of any kind

`is_weak`, `is_strong`, `needs_revision_now`, `at_risk`, `struggling`. Covered at length in §1–§3; restated here because this is the section the brief asks for it in. Every one of these is a threshold applied to a stored fact, owned by whichever module applies it, never by the engine.

### 15.6 Cross-student rank, stored

A student's percentile or class rank changes the instant *any other student's* data changes. Storing it as an owned fact means every other student's attempt potentially invalidates a value that has nothing to do with them — a write-amplification problem that gets worse, not better, at 1 million students. Rank/percentile is always computed at read time (possibly cached with a short, explicit TTL) by whichever module needs it (Ranking), never treated as ground truth the engine owns.

### 15.7 Predicted future scores as persisted "facts"

A model's prediction of a future exam score is a model output, tied to a specific model version, not an observation. If stored without explicit versioning, it becomes indistinguishable later from an actual measured outcome — a serious problem for both auditability and for retraining the model that produced it. If predictions are ever persisted at all, they must carry the model version and be clearly distinguished, in schema and in any UI, from observed facts. The default in this design is: do not persist predictions; recompute them from the (versioned, re-derivable) signal layer on demand.

### 15.8 Percentile-normalized scores as the primary representation

Similar to §15.6 but broader: any "score out of 100" that has already been normalized against a shifting population should never be the *only* stored representation of a fact, because the moment the comparison population changes (new cohort, new year, new exam board), the stored number silently means something different than it did when it was written. Store raw counts and ratios as primary; normalize at read time, always against an explicit, stated reference population.

### 15.9 Free-text psychological/behavioral profiling

"This student seems anxious," "this student is disengaged" — anything inferring emotional or psychological state beyond directly observable academic behavior. No clear derivation exists from the signals in this document to a claim like this, it is easy to bias, and it is difficult to justify to a parent or a regulator asking what a system knows about their child and why. Out of scope entirely, not deferred — this category should not exist in this engine at any future phase.

### 15.10 Raw keystroke/mouse telemetry and device/location fingerprints

No question type in this product currently requires continuous input capture (no free-text or code-editor questions), so fine-grained interaction telemetry has no pedagogical justification and only privacy/storage cost. Device, IP, and location data, if ever needed, belongs to a security/fraud system, kept architecturally separate from academic records — commingling them increases the blast radius of both a data breach and an academic-data export to a parent or teacher.

### 15.11 Deletion of raw facts

Not a "don't store" rule but its mirror: raw attempt events, once written, are never deleted, even when a question is retired or a concept re-tagged (§17). They may be **cold-archived** (moved to cheaper, slower storage after a retention window) for cost/performance reasons, but never discarded — the ability to recompute an entirely new signal invented three years from now, retroactively, over full history, depends on this.

---

## 16. Storage Design (Restated Against the Taxonomy)

Restating §4's taxonomy with the ownership and access pattern each kind implies:

- **Raw facts** (§8's `attempt_event`): append-only, time-partitioned (e.g. monthly), never updated or deleted, indexed by student and by question for the two access patterns that matter (a student's history; a question's population). This is the only layer where losing data is unrecoverable.
- **Aggregated facts** (counters, BKT posteriors, half-life estimates): mutable, updated incrementally on every relevant raw event, one row per (student, concept) and equivalent keys at other layers. Never recomputed from full raw history on a normal write — only ever incremented/updated from the previous aggregate plus the new event (this is the pattern this codebase already validated this session with `_upsert_question_record`'s `ON CONFLICT ... DO UPDATE`).
- **Derived facts** (accuracy, `measurement_confidence`, `retention_estimate`, `trend_delta`): never stored at all. Computed from aggregated facts at query time via a pure formula. If a derived fact is expensive enough to need caching, it is reclassified as a **cached fact**, not silently promoted to a stored aggregate.
- **Cached facts** (item calibration, discrimination index, cross-population percentiles): stored, but explicitly time-stamped (`computed_at`) with a defined staleness window, recomputed on a schedule (batch/cron), never expected to be real-time-accurate. Consumers of cached facts must be able to tell how stale a value is.
- **Runtime-only facts** (a live in-session streak counter, a request-scoped IRT re-estimate during one adaptive-practice session): exist only in application memory for the duration of one request or session, never written to durable storage at all.

---

## 17. Edge Cases

- **Question re-tagged to a different concept after being answered by thousands of students.** Historical attempts must not silently move to the new concept — the raw event's `concept_tags_at_attempt_time` snapshots the tag as it was at attempt time (§6), so historical concept-level trend signals remain intact even as the question's *current* tag (used for all *future* attempts) changes.
- **Question soft-deleted / retired mid-year.** This codebase already solved the general shape of this problem for Practice specifically (`is_active` flag, `ON DELETE RESTRICT` rather than `CASCADE`, so history can never be silently destroyed by a content operation) — the Signal Engine adopts the same pattern: retired questions stop being selectable for new attempts but their historical attempts, and any signals derived from them, remain fully intact and queryable.
- **Student switches board, stream, or class mid-year** (e.g. a genuine curriculum change, not a data-entry error). Concept history does not automatically merge or transfer across a curriculum change — this requires an explicit, product-level curriculum-mapping decision (which concepts in the old scope correspond to which in the new one), which is out of scope for this document and must be designed separately if/when it becomes a real requirement.
- **A student rapid-guesses to inflate attempt counts.** Not prevented at the data layer, but *contained*: abnormally fast times feed into the same evidence used for `measurement_confidence` and (once BKT's `P(guess)` is calibrated) mastery estimation, so gaming the count does not straightforwardly game the mastery signal the way it would if raw accuracy alone were the only thing stored.
- **Concurrent attempts from multiple devices/tabs for the same student.** The single shared ingestion contract (§14) must be idempotent per attempt (a client-generated attempt ID, not a server-side sequence assumption), so a retried or duplicated network request cannot double-count an attempt. This is an implementation-time requirement to carry forward, not a data-model change.
- **A brand-new signal is invented three years from now.** Answerable *retroactively* over full history, because the raw layer (§8, §15.11) was never lossy or pre-aggregated-only. This is the single strongest argument in this whole document for why the raw layer must exist and must never be deleted — every other layer can be wrong and rebuilt; the raw layer cannot.

---

## 18. Scalability (1M students · 100M attempts · 20M attempts/day)

- **Raw layer:** time-partitioned, append-only. Hot (recent) partitions stay fast; older partitions cold-archive without ever being deleted (§15.11). No query pattern in this design requires a full-history scan of the raw layer — every consumer reads aggregates.
- **Aggregation is strictly incremental.** Every write to an aggregated fact is `current ⊕ new_event`, never a recompute-from-scratch. This is the single most important scalability property in this document, and it is the one already validated at smaller scale in this codebase's own Practice Engine work.
- **Vertical rollups are hierarchical, not flat.** Topic/Chapter/Subject/Student aggregates are recomputed from the *concept* layer (dozens to low-hundreds of rows per student), never from raw events (potentially millions of rows per student over years) — bounding the fan-out cost of every layer above concept.
- **The student is the natural partition/shard key** for the entire student-vertical axis — over 99% of real queries are scoped to one student, so this axis shards cleanly. Only the item-quality/population axis (§10) genuinely needs cross-student aggregation, and that work is explicitly pushed to scheduled batch jobs over the population, not computed live on any student-facing request.
- **Item calibration and cross-population statistics run on a schedule (nightly/weekly), not per-attempt,** and may sample rather than scan full population history once the population is large enough that a sample is statistically sufficient — these are the only computations in this design that are population-wide, and they are also the only ones with no real-time latency requirement.
- **Expensive read-time derived facts** (e.g., rank/percentile) are cached with an explicit short TTL rather than recomputed on every request, without being promoted to a durable, engine-owned aggregate (§15.6).

---

## 19. Risks

- **Threshold drift changes historical judgments retroactively.** Because verdicts are computed live from facts (by design, §1–§3), a dashboard showing "weak concepts" today can show a materially different list tomorrow purely because a consumer changed its threshold, with no change in the underlying student data. This is an accepted, deliberate tradeoff of the whole design — but it means any product surface that needs historical fidelity of a *judgment* (e.g. "what did the teacher see in March") must snapshot that judgment explicitly at the time it was shown, with the threshold version that produced it, rather than assume it can be reconstructed later from current thresholds applied to historical facts.
- **Cold start.** New students and new questions have low `measurement_confidence` everywhere, by design (§7) — this is statistically correct but a real product/UX problem (how does a dashboard represent "not enough data yet" without looking broken or blank) that this document deliberately does not solve, because it's a product design question, not a data design one.
- **Per-student BKT/IRT overfitting.** Fitting four free BKT parameters, or a full IRT ability curve, from a handful of per-student attempts is a well-documented way to get confident-looking garbage. Mitigated by seeding from population-level priors (§9.2) and explicitly deferring fully individualized parameter fitting to a later phase, not attempting it from day one.
- **Privacy and data-minimization risk.** Even with §15's exclusions, granular per-question time and outcome data is still meaningfully sensitive academic information about a minor in most jurisdictions this product operates in. This design's mitigation is architectural (§14: parent/teacher/principal surfaces never touch the raw layer, only aggregates) but a full data-retention and access-control policy is a separate, necessary piece of work this document does not cover.
- **Gaming/adversarial use.** Any signal that becomes visible to students and rewarded (e.g. a visible "mastery score") creates an incentive to optimize for the number rather than the learning. Mitigated by not exposing raw formulas/thresholds to students, and by keeping difficulty-weighted signals (§9.5) available so a "farm easy questions to inflate the number" strategy is visibly distinguishable from real mastery — but this is a UX/product policy decision more than a data one, and needs to be revisited whenever a new student-facing surface is built on top of this engine.
- **Model/vendor lock-in through the schema.** If BKT- or IRT-specific parameters get treated as the canonical representation of mastery rather than one versioned, replaceable model output built on top of the durable raw+aggregate layers, upgrading or replacing the model later becomes a migration instead of a deployment. Mitigated by §1's core principle and by every model-derived signal in this document being explicitly labeled as such.

---

## 20. Future Expansion Roadmap

- **Phase 1 (this specification):** raw event log; student×question, concept, topic, chapter, subject, student rollups; Classical-Test-Theory accuracy with Wilson-interval confidence; simple exponential retention/half-life; stability, consistency, and trend signals via the generic patterns in §9.4/§9.8. No population-level calibration yet — every concept starts with the same generic priors.
- **Phase 2:** item-quality calibration (§10) — empirical difficulty, discrimination index, abnormal-rate flags — once enough population data exists per item. Purely additive; does not change anything in Phase 1.
- **Phase 3:** population-level BKT priors per concept, seeded from Phase 2's data, feeding `mastery_probability` (§9.2) as a genuine addition alongside (not a replacement for) `raw_accuracy`.
- **Phase 4:** individualized parameter refinement (per-student BKT parameters, IRT ability estimation `θ`) once the population-level version has enough data to make individualization statistically safe rather than overfit (§19). This is also the phase that unlocks true adaptive/computerized-adaptive-testing-style question selection.
- **Phase 5:** sequence models (Deep Knowledge Tracing or successors) trained directly on the Phase-1 raw event stream — an addition on top of, not a replacement for, the BKT/IRT layers, feeding Nova's next-question and next-explanation recommendations.
- **Phase 6:** curriculum expansion — new boards, new exam types (competitive exams, college prep). Because concepts are tagged via an extensible graph (§5) rather than a fixed tree, and because the raw layer already snapshots tags at attempt time (§6, §17), this phase should require *extending* the concept/tag taxonomy, not redesigning the signal engine underneath it — this is the direct test of whether this document achieved its stated ten-year goal.

---

## Appendix: What Was Borrowed From the Research, and What Was Deliberately Not

| Borrowed | From | Adapted how |
|---|---|---|
| Wilson/Jeffreys interval for small-sample confidence | Classical statistics (Wilson 1927), Jeffreys prior | Used directly, no modification — this is exactly the right tool for the exact problem stated in the brief |
| BKT's four-parameter mastery model and Bayes-rule update | Corbett & Anderson (1994) and the wider ITS literature | Priors seeded per-concept from population data rather than global constants; individualized fitting explicitly deferred (Phase 4) rather than attempted per-student from day one |
| IRT's difficulty/discrimination/ability separation | Classical 2PL/3PL IRT | Difficulty and discrimination adopted as item-quality signals now (Phase 2); ability estimation (θ) explicitly deferred to Phase 4 pending item calibration |
| Exponential forgetting curve with a fitted, personalized half-life | Ebbinghaus forgetting curve; Duolingo's Half-Life Regression | Half-life updates driven by observed behavior (correct/wrong/time), not self-reported recall difficulty (as SM-2 uses) — no self-report step exists in this product |
| Point-biserial discrimination / item analysis | Classical Test Theory item analysis | Used directly for question-quality signals (§10) |
| Log-normal response-time modeling | van der Linden (2006) | Referenced as the statistically correct future direction for time modeling; not required for Phase 1, where simple bucketed histograms are sufficient and far cheaper |
| Power law of practice | Snoddy (1928), Newell & Rosenbloom | Used as the theoretical grounding for why `speed_trend` is a meaningful signal, not as a literal formula fit per student |
| **Deliberately not adopted:** Deep Knowledge Tracing as a built-in engine component | — | Treated as a future *consumer* of the raw event stream (Phase 5), not built into the schema — DKT needs no new raw data beyond §8, so building it in now would be premature architecture for a model that may itself be superseded before it's ever trained |
| **Deliberately not adopted:** SM-2's discrete self-reported quality scale | SuperMemo SM-2 | This product has no self-report step in its question flow; behavioral signals (correct/wrong/time) are used instead, closer to HLR's approach |
