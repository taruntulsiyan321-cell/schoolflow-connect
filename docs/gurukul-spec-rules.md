# Gurukul — standing rules

Commit to `docs/gurukul-spec-rules.md`. This file supersedes the claude.ai project file previously cited as `gurukul-handoff-prompt.md`, which was never in the repo and which two sessions were told to obey while unable to read it.

**The product spec is `docs/locked-decisions.md`, in this repository, on every branch including `main`.** It is named here because three documents have now been treated as missing when they were only unnamed, and a fourth session spent its opening searching for this one. Its numbered clauses must be re-read before touching anything they govern:

| clause | where |
|---|---|
| §10.8 Practice | `docs/locked-decisions.md:269` |
| §10.11 Resources | `docs/locked-decisions.md:422` |
| §10.12 Student panel | `docs/locked-decisions.md:436` |
| §10.15 Parent panel | `docs/locked-decisions.md:496` |
| §10.18 Admin panel | `docs/locked-decisions.md:564` |
| §10.9 Question bank | `docs/locked-decisions.md:385` |

**A citation correction, because two rulings rested on it.** The question bank's sharing rule is **§10.9**, in `docs/locked-decisions.md`. It has been cited in session prompts as "§4.2a", which is a different clause in a different document (`recovery-revision-analysis-spec.md:193`, *Generating the variants*) and belongs to the frozen recovery feature. §4.2a does say "saved to the shared bank", but its sharing is across STUDENTS and over TIME — "there, free and instant, for the next student who fails the same one" — and it defers to §10.9. The phrase "across schools" appears in neither document. §10.9 is the one that says it: "Centralised and shared across all schools and all users." The substance of the ruling is right; cite §10.9 for it.
| §4.2b Readiness on the ladder | `docs/recovery-revision-analysis-spec.md:221` |
| §4.2a Generating the variants | `docs/recovery-revision-analysis-spec.md:193` |

Line numbers drift as the file is edited; the headings (`## 10.8 Practice (student panel)` and so on) are the durable anchors. Where code and spec disagree, the spec wins and the code is the bug — this has now overturned two rulings, so it is not a formality.

Rules 1–23 are as issued. Rules 24–27 were added 2026-09-05. Rules 12–15 and 18's second half are **parked** — see the Parked section; they describe a feature with no code.

---

## RULE 0 — HOW EVERY CHANGE IS MADE

Issued by the product owner 2026-09-11, and it governs every other rule in this
file. It applies to bug fixes, feature changes and refactors alike.

**Never patch around defective code. Remove it, re-analyse it, rewrite it, and
reconnect everything it touched.**

1. **REMOVE** the whole defective piece — not the symptom, not one branch.
2. **RE-ANALYSE** before writing anything: what did it do, what fed it, what
   read it, what did it silently rely on, and what relied on it. Write the
   connection inventory down. That inventory IS the work; a rewrite that skips
   it relocates the defect instead of removing it.
3. **REWRITE** it properly, in one piece, with the change you actually wanted.
4. **RECONNECT AND REVIVE** every wire the old code had, and verify each one.
   Nothing that worked before may silently stop working. If a caller leaned on
   the old behaviour, carry that behaviour across or fix the caller too.

**Corollary:** when a patch is superseded by the proper rewrite, delete the
patch. Leaving both is two homes for one behaviour — the G9 shape that this
codebase has now produced five times.

Worked examples, both done this way end to end: `src/academic/services/testService.ts`,
and `src/gurukul/emptyStudent.ts` + the merge in `src/pages/StudentDashboard.tsx`
(commit `4e4bf15`) — where patching three screens one at a time kept failing
because the defect was the TYPE and the merge that filled it, not any screen.

---

## On thresholds

1. **No threshold literals.** The count is currently 0. Every boundary is a named constant in the spec's own units; consumers multiply by 100 at the display edge, never the other way round.
2. **Never gate on a rounded percentage.** `Math.round(99.6) === 100`. When the question is "did anything go wrong", ask it directly.
3. **A band is not reusable because it compiles.** Finance has `FeeCollectionBand`, exams have `ExamScoreBand`, accuracy has its own. Reusing the academic `Band` across measures typechecks, which is exactly the danger.
4. **Below-pass is not a number.** It stays a `Metric<boolean>` derived from `exams.passing_marks`, so unknown propagates instead of silently becoming a pass.
5. **Composites hide from the literal gate.** `academic = (testsAvg + examsAvg) / 2` contained no vocabulary word and so was invisible to it. Where two rates must be compared, take the worst — furthest below **its own** line — and name which one it was. Never average them (§4.2b).

## On verification

6. **A `DO $verify$` block proves nothing about access.** It runs as `postgres`: superuser, RLS bypassed. It can show a policy exists and that a predicate contains a string. It cannot show that anyone is refused.
7. **Use `npm run verify:caller-privileges`.** It impersonates real users via `set_config('request.jwt.claims')` + `set_config('role','authenticated')` inside a rolled-back transaction and catches exceptions as data. **114 assertions currently pass** (was 26, then 99 before probe13). Every new guard gets an assertion here — not a `DO` block.
8. **Pair every denial with a positive control.** A first version of the probe used invalid SQL: all four insert probes failed with a syntax error and three still scored PASS, because the assertion only looked for the word `ERROR`. A refusal you cannot distinguish from a typo is not evidence. Prove the guard isn't passing hollow by breaking the feature — a school-B row refused **and** the own-school path still working.
9. **Scope denial probes to one row by primary key.** `EXISTS` over `academic_audit` (8,878 rows × `same_school()`) times out for a role that sees nothing, which made the denied case untestable.
10. **Row counts are evidence about usage, not proof of breakage.** Establish which before concluding. **See rule 24 — in this database they are mostly evidence of seeding.**

## On audience

These are the product owner's, given directly. They override any inference from code or from a §-clause read in isolation.

11. **The student's Analysis tab is fed by practice, and by nothing else.** It is a week-wise topic analysis wired directly to practice. Neither test data nor **exam/marks data** feeds it. *(Amended 2026-09-05: `Analysis.tsx:142–178` currently fetches marks and exams and computes against `exam.maxMarks`. That is the defect. Removing it will leave Analysis near-empty for a student who does not practise — that is correct and honest. The student's exam marks live on their marks surface.)*

12. *Parked — see Parked section.*
13. *See "The test report" below — binding, and corrected 2026-09-11.*
14. *Withdrawn 2026-09-11 — see "The test report" below.*
15. *See "The test report" below — binding.*

16. **Do not "reconcile" the student's practice-derived Analysis against §10.15.** §10.15's "tests and exams only, never practice" governs the parent-facing weak-concept alerts, which do not exist. The Analysis tab is a different surface with a deliberately different source. §4.2b still stands independently: practice and test/exam rates are never blended into one figure — separate sources feeding separate surfaces is not blending.

17. **The parent's weekly report contains exactly:** that week's attendance; homework completed; homework not completed; a teacher's remark if one exists; and test marks where a test was conducted online. Marks, not the test report. Nothing else — not topics, not scores rolled into a judgement, not encouragement (§10.8). *(Verified compliant 2026-09-05: `_parent_weekly_digest` carries exactly these, `exam_marks`/`alerts`/`marks` absent, online-only filter present, scheduled at cron job 2, `30 1 * * 1` GMT = 07:00 IST Monday. Item 4 is structurally always empty because `teacher_remarks` has 0 rows — the UI is reachable at `LiveClassPanels.tsx:647`, it is simply unused.)*

18. **Visibility follows role relevance, not secrecy.** What the school issues to its students is school data; within the school it is not hidden by default, and a restriction needs a reason from the spec rather than caution. Do not restrict a role beyond the spec on your own judgement, and do not widen one either; where the spec is silent, ask. *(The principal/test-report clause is parked with rules 12–15.)*

## On spec vocabulary

19. **A class row *is* a section.** The three FKs — `attendance_submissions`, `section_subjects`, `student_enrolments` — all point at `classes`. Every "a section they teach" resolves to `teacher_teaches_class(auth.uid(), class_id)`. A genuine sub-class grouping requires a `sections` table and a ruling; do not invent one silently.

## On process

20. **Don't delete a handler to make a gap disappear.** Where a handler exists and its emitter does not, the handler is the half already right.
21. **`npm run db:types` is fixed** (verified 2026-09-05). `scripts/gen-types.mjs` has five guards — exit code, JSON body, `export type Database` marker, 20 KB floor, 20% shrink guard — then temp-file plus atomic rename.
22. **Every migration ships with a rollback and a caller-privileges assertion.** Apply with `npm run db:migrate`, confirm with `npm run db:check-migrations`.
23. **Gates before every commit:** test suite, `npm run typecheck` (**never** `npx tsc --noEmit` — the root tsconfig's `files` is `[]`, so it compiles zero files and cannot fail; measured 2026-09-09), `db:check-migrations`, and `npm run lint:baseline`. Since 2026-09-09 `db:check-migrations` is a real set-difference against `public.schema_migrations` over every migration file and exits 1 — it used to ask 27 hand-written marker questions, cover 27 of 414 migrations, and exit 0 either way. See Lint below for what the lint baseline does and does not prove.

## Added 2026-09-05

24. **The database was seeded by direct writes, and the service layer has never been exercised.** 458 `test_attempts` were created on 2026-08-29 across 40 users, all `submitted`, none through `rpc_test_submit`. Six exams carry `results_published_at` without `publishResults` ever running; eighteen exams exist without `upsertExam`. Trigger-based emitters fired because triggers fire on any INSERT; service-layer emitters did not, because a seed never calls a service. Consequences: a service-layer emitter with 0 events is **unexercised, not dead**; a populated table is not evidence a code path works; and no frozen-scope feature has been driven end-to-end through the UI. Establish provenance before drawing any conclusion from a count.

25. **Distinguish what the school taught from what the system inferred.** A parent may see the former; the latter is not theirs. A test's topic is school data. A weak-topic inference about their child is not, and does not appear on any parent surface.

26. **Production is the source of truth for edge functions until a hash says otherwise.** 1 of 17 deployed functions had a known relationship to its repo source; two (`ai-expand-questions`, `mcp`) had no source on any branch. Date heuristics were wrong in both directions — only a content hash settles it. The verbatim production snapshot lives on `claude/edge-function-provenance`; it is a recovery artifact and is **not merged to main**, because the repo side contains work that may never have been deployed. A deploy-time hash gate is required before any function ships.

27. **A missing-data render must not read as a data-bearing render.** `TestResult.tsx` rendered every question with the correct answer and a blank student response, under copy stating wrong answers were saved to the Mistake Book. It looked functional and misrepresented. Where data is absent, say it is absent. *(FIXED 2026-09-12. The honest empty state landed first, and then the CAUSE was found and removed: `rpc_test_submit` deleted `test_answers` at submit, so the responses were absent for every student after every test. The screen now reviews the real paper through `rpc_test_answer_sheet` and keeps the empty state for the case where the rows genuinely are not there — a pre-20260925000000 attempt.)*

28. **`has_role/2` asks whether the caller is acting in a role; `has_role/3` asks whether an account holds one.** They can disagree about the same person at the same school, deliberately. Choose by the question, not by argument count. *(Because `memberships` is UNIQUE on `(account_id, school_id, role)`, one account can hold several roles at one institution; collapsing the two forms would blend them regardless of which is active. All 111 live policies use the two-argument form, which is correct — a policy always has a session. The three-argument form exists for callers that have none and know which institution they mean.)*

29. **A guard that matches a function or file body must strip comments first — in both directions.** Asserting ABSENCE, a comment naming the forbidden identifier fails a correct change: this cost two sessions over `examAvg`, in `f6e2f51` and again in `1ec1628`. Asserting PRESENCE is worse, because a comment containing the required string lets a genuinely unguarded function pass as safe. `stripComments()` in `scripts/lint-render-safety.mjs` is the implementation to copy; it blanks comment bodies while preserving line and column offsets. Pair the guard with a control proving the stripper ran — otherwise a stripper that silently fails makes every assertion around it meaningless (G11).

30. **`active_membership_id()` must never be NULL for an account holding at least one active membership.** 111 policies key on it through `has_role/2`, so a NULL is not a degraded answer, it is a total account lockout — and it presents as a fully-rendered app in which nothing works, because `src/auth/session.ts` resolves the client-side role from `memberships` directly and routes on it. Where a default must be chosen, it is `ROLE_PRIORITY` from `src/auth/session.ts:18-25`, mirrored in `public._role_precedence`; the database and the client must agree on which app the user is in. **The `app_role` enum order is not a privilege order** — it is `(admin, teacher, student, parent, principal, super_admin)` — and must never be used for this.

## Added 2026-09-06

31. **Topic is not an ANALYSIS unit; chapter and subject are. It is now a
    SELECTION filter, where a teacher supplies one.** Updated 2026-09-10, when
    the batch job this rule deferred was actually run.

    **What was deferred, and is now done.** This rule said unification into a
    canonical per-chapter taxonomy was "a batch data job, not app work:
    cluster each chapter's questions on the embeddings they already carry,
    name the clusters, then assign new questions by nearest-cluster similarity
    with a threshold, flagging anything below it rather than inventing a
    topic." That is `scripts/classify-question-topics.mjs`, and
    `question_bank.topic_group` is its output (`20260916130000`). `topic`
    itself is untouched, so this is additive and reversible.

    **The prediction in the old text was optimistic, and the measurement says
    so.** It estimated a viable taxonomy would land at "roughly 1,000-1,500
    topics against 523 existing chapters". Measured after the real run:

    | | |
    |---|---|
    | topic groups | **10,273** |
    | questions per group, median | **1.0** |
    | questions per group, mean | 2.1 |
    | groups holding 15 or more | 86 |
    | singletons | 6,379 (62% of groups) |
    | questions sitting in a group of 15+ | 10.9% |

    Merging fixed CONSISTENCY — `taddhit_pratyay` now gathers 30 spellings
    across 51 questions instead of scattering them — but it did not produce
    DENSITY, because the source labels were written per question, not per
    topic. Against this rule's own bar of 15-20 questions per topic, "or one
    bad day reads as a weakness", the bank is nowhere near it.

    **So the conclusion is unchanged and now better evidenced: no
    student-facing analysis moves to topic level.** Weakness, mastery,
    recovery and reporting stay at chapter and subject.

    **What changes is selection.** A teacher may narrow a question paper
    section to topics they choose: `question_paper_sections.topics`, honoured
    by `rpc_fill_paper_section_from_bank` (`20260916150000`), offered in the
    UI as chips carrying each topic's question count — chosen from the
    vocabulary, never typed, because guessing which of thirty spellings the
    bank stored is the problem this solved. Empty means the whole chapter set,
    never "no topics". This was always permitted: the original parenthetical
    said the rule "does not remove topic as a stored tag or as a filter where
    one is already supplied".

    **Generated questions still carry `chapter` and leave `topic` NULL. Never
    a guessed topic string.** That has not moved. What is now possible is the
    second half of the prescription: once the embedding worker has embedded a
    new row, `--incremental` files it into the nearest EXISTING group in its
    own (subject, chapter), and only if it is closer than the threshold.
    Below it, the row stays NULL — that is the flag, and the question is still
    findable by chapter. It never creates or names a group; naming is the full
    run's job, which has the whole chapter in front of it. First run: of 11
    rows with a candidate, 1 was within 0.15 and 10 were left alone.

    *(§10.9 lists topic among the tags that "keep content appropriate" and says
    a student sees "nothing outside their class, subject, chapter or topic".
    The tension this rule used to note is now resolved in the direction §10.9
    wanted: topic is a real, consistent tag that a filter can key on, while
    remaining too thin to carry analysis.)*

32. **Work is not landed until `git ls-remote` shows it.** Committing is half the guarantee; a commit on one machine is one disk failure from gone. A deploy whose source is unpushed is the same defect as a deploy whose source was never committed — `ai-expand-questions` and `mcp` reached production that way, and six sessions of schema, migration and edge-function work sat local-only for weeks the same way. Every session ends by pushing and confirming from the remote. Preflight fails if `HEAD` is **ahead** of `origin`, not only behind.

    *(Enforced by `npm run check:pushed`, which is the FIRST thing `npm run preflight` runs. It asks `git ls-remote` rather than reading `refs/remotes/origin/*` or a local `git log` — both of those answer "what did this machine last hear", and both reported everything fine throughout the incident that produced this rule. `--all` checks every local branch. A branch that DIVERGED is pushed as `<branch>-local-YYYYMMDD` and reconciled deliberately; it is never force-pushed. Being unable to reach `origin` fails too, because "I could not ask" must not look like "nothing to push".)*

    *(Measured 2026-09-07 when this was written: `claude/threshold-rulings-schema-f179b7` was **16 commits ahead** of its remote, and `claude/edge-function-provenance` — which holds the only copy of `mcp/index.ts` outside the running deployment — had never been pushed at all in eight sessions.)*

---

## The test report — UNPARKED 2026-09-11, and the expiry is ruled out

This section used to open "**No code exists for any of this**" and describe an
ephemeral report. Both halves are now out of date: the report is built (Screen 17
of the v2 student panel pass), and the expiry was ruled against on 2026-09-11
after it was measured. Rules 12, 13 and 15 are binding. **Rule 14 is withdrawn.**

12. The test report is a separate, self-contained artifact — not an input to anything. Generated the moment the test ends, downloadable. It feeds no weak-topic surface, no Analysis tab, and no parent surface.
13. **Marks and rank are shared within the class; per-question detail is private to each student.** The earlier wording — "their own data only … never the class's" — predated the test leaderboard and was too broad: a rank is a position among classmates and cannot be shown without comparing to them. What stays private is the per-question detail: which questions a student got wrong and which took longest is theirs alone, never another student's. **Teacher** — the class aggregate is the primary view; clicking a student's name opens that student's report, scoped via `teacher_teaches_class`. **Principal** — ~~nothing~~ **the MARKS, corrected 2026-09-12** (see the ruling below): the test and what each student scored, on the class tab. Still not the per-question detail and still not the weakest-topic report. *(Corrected 2026-09-11 on the product owner's ruling; `rpc_test_student_report` implements the private half — it returns `rank` and `class_size` as positions and no other student's name or mark — and `rpc_test_class_marks` implements the principal's half, fenced separately by `can_read_test_marks`.)*
14. ~~Deliberately ephemeral — a 24-hour tab, then gone.~~ **WITHDRAWN 2026-09-11.** Measured first: there is no `expires_at` on any test table and no purge function for test answers, so nothing expires today, and the spec requires that it does not. §10.23 makes test answers school data that persists — "a teacher set them and a mark is the point" — and §10.25 requires "their actual wrong answers, with the topic on each" on tap, which needs them kept. Building the expiry would delete school data the spec preserves and empty the §10.25 drill-down. It would also be the more complex path by a wide margin: an `expires_at` column, a purge function, a cron entry, a guarantee that marks reach the profile *before* deletion runs, a marks-only fallback on two panels, and probes for each — against zero new code for leaving it durable. Ruled by the product owner on exactly that trade.
15. Only the marks persist **on the student profile** as the durable summary — the profile shows marks, not the report. This is unchanged: it is about what the *profile* carries, not about deleting the report.

## The test flow — RULED 2026-09-12, and built

Four rulings, in the product owner's own words, and what each one settled. They
supersede where they conflict, and the conflicts are named rather than quietly
resolved.

18. **"For the online test, only MCQ questions can be given … the test
    automatically gets marked."** No human marks an online test, ever. Measured
    before building: of the five formats `test_questions` admitted, only `mcq`
    could actually be marked — `short` and `long` carry `correct IS NULL` by
    constraint so every written answer scored zero in silence, `multi` marks a
    correct answer wrong whenever the student's click order differs from the
    key's, and `numerical` has no tolerance. Enforced by
    `trg_test_question_is_a_markable_mcq` (20260925020000), not by the builder
    alone. Question marks are whole numbers for the same reason: `tests.max_mark`
    and `test_marks.mark` are integer columns and a half mark was being rounded
    into what a parent and a principal read.

19. **"The leaderboard shall also be dynamic: … the first student to complete the
    test is already shown at the top. As soon as all the students start
    submitting, the leaderboard gets updated."** This is the NAMED leaderboard
    that 20260916030000 declined to build without a ruling. Built as
    `rpc_test_leaderboard` (20260925030000): every submitted attempt, ranked by
    mark, ordered so that on equal marks whoever finished FIRST is above — and
    ties share a rank, computed identically to `rpc_test_student_report.rank` so
    the two surfaces can never disagree. Readable by the teachers of the section,
    the principal, and a student **who has already handed their own paper in**;
    before that a student would be reading the class's marks for a paper they
    have not written.

20. **"For the principal … on the class tab, the principal shall be able to see
    the test and the marks each student has got."** SUPERSEDES the 2026-09-09
    "Admin and Principal sees nothing" ruling, for marks only. The principal
    reads `rpc_test_class_marks` and is still refused `rpc_test_class_report`
    (weakest topics, timing) and `rpc_test_student_report` (which questions a
    named child got wrong) — rule 13's private half is unchanged.

21. **"For the admins, we have to build all the numbers of tests given in the
    school."** Counts, not marks: the admin dashboard's "Tests Given" card reads
    totals over `tests` and `test_attempts`, both of which their existing
    policies already admit. `can_read_test_marks` refuses them one class's named
    marks, deliberately.

**One instruction in that session was NOT built, and this says so rather than
leaving it implied.** The same message asked that the report "automatically gets
removed after 24 hours and gets added to the student's profile." The marks half
is done and verified — `rpc_test_submit` writes `test_marks` in the same
transaction as the grading, before any report exists, and the student profile
reads it. The DELETION half is rule 14, which this product owner withdrew on
2026-09-11 after it was measured, for reasons that have not changed: §10.23
makes test answers durable school data, §10.25 needs "their actual wrong
answers, with the topic on each" on tap, and the 2026-09-12 session's own work
depends on those rows surviving — deleting them at 24 hours would empty the
student's review, the teacher's drill-down and the weakest-topic ranking a day
after every test. Building it would re-open the defect 20260925000000 closed.
**If the expiry is wanted anyway, it needs a fresh ruling that also says what
replaces those three surfaces afterwards.**

---

**A real defect this section still names:** `battle_reports` has `expires_at` and a UI gate at `BattleReportView.tsx:151`. It now also has a collector — `purge-expired-battle-reports`, cron `20 * * * *`. Battles are practice under §10.8, so an expiring battle report is correct and is **not** a precedent for tests.

---

## The test feature — the owner's decisions, RECORDED 2026-09-13

Not yet built. Recorded here so the next session builds THIS and not its own idea of it.

**A test is a delivery of a question paper, not a copy of one.** One paper, one answer
shape, and `tests` holds only: which paper, which class, which mode, when it goes live.

**The mode the student answers in is chosen FIRST**, because it decides everything after.
Online means the student is shown MCQs with their options and simply chooses — nothing
else appears on a phone, and it must feel effortless.

**Three ways to put questions on a paper. Not four.**

1. **The question bank** — proper filtering, and it must feel like **drag and drop**: the
   teacher filters, then drags questions onto the paper.
2. **The AI** — customised so it generates questions properly, **produces the answer key
   with them**, and the result is uploadable into the app as a test.
3. **The teacher types it** — types the question, enters the four options, chooses which
   one is correct.

**PDF / photo EXTRACTION IS CUT.** Ruled out on 2026-09-13. We do not read questions out
of an uploaded paper. The obstacle was never the OCR: a question paper carries no answer
key, so extraction can never produce an auto-markable online test on its own, and
`src/academic/ai/multimodalPipeline.ts` is a stub in any case ("Live vendor extraction
deferred"). Do not rebuild this without a fresh ruling.

**Also ruled earlier in the same discussion and still standing:** a test that has been sat
must be deletable and the count must drop everywhere; students are neither shown nor told
about a test until `goes_live_at`, which is what makes that deletion window real.

**Sequenced after homework.** The owner's instruction on 2026-09-13: finish the homework
feature first.

---

## The teacher's test report — what it must answer, RULED 2026-09-13

Four questions, and the report had honest answers to one of them.

| The teacher asks | Before | Now |
|---|---|---|
| Where does the class stand? | a list in ROLL order with marks beside it | `rpc_test_leaderboard` — ranked by mark, ties shared, the same order and rank the students read on their own result |
| Which question do I re-teach? | `average_seconds_per_question` — the paper's mean over its length | `rpc_test_question_breakdown` — every question with its own average and longest time, the four outcome states apart, and the student it cost the most, by name |
| What did the class get wrong? | weakest topics | unchanged |
| How did THIS child do? | their WRONG answers only | `rpc_test_answer_sheet` — the whole paper: every question, their answer against the key, marks awarded, and their own time on each, with their slowest marked |

**Why the paper mean had to go rather than be kept alongside.** It cannot
distinguish nineteen ten-second questions and one twelve-minute one from twenty
forty-second ones, and only the first names something to do. Keeping it as well
would leave two timings on one screen disagreeing about what "per question"
means (G9). It is deleted from the teacher's report; `rpc_test_class_report`
still returns the field and the student-facing surfaces still use it.

**Why the drill-down had to change.** "Wrong answers only" is not a
performance. A student who scored full marks opened an empty panel, and nothing
anywhere said how long any question took them.

**NULL is not zero, on every timing.** An answer written before the
per-question clock existed carries `time_ms IS NULL`. Averaged as zero it makes
a paper look faster the older it is, so: the average covers only the timed
rows, `timed_count` says how many that is, and the slowest student's id, name
and time are all NULL together or all set — a name with no time is not a fact
(§7, G4).

**The fences are unchanged and unduplicated.** The breakdown is fenced by
`can_read_test_report`, the same function as the class report, so the principal
is refused here exactly as they are refused there and the argument about §10.25
stays in one place. The board is `can_read_test_leaderboard`, the drill-down
`can_read_test_student_report`. No role check was added in any component or
service.

**Where it lives.** `src/gurukul-teacher/TestReportPanel.tsx` — its own file.
It was inside `LiveTestsTab`, which is the test LIST and its builder.

---

## Chat and the teacher's Question Bank are removed — RULED 2026-09-13

**The instruction, in the owner's words:** "Question Bank and communication have to
be removed completely", "Communication was to be removed from everywhere inside
the application", and of the teachers' AI: "Teachers' AI was only meant to create
question papers and upload them to the classes that teach."

**Chat is gone from the product, not hidden.** Removing it from one panel only
would have left parents and students writing to teachers who have no screen to
read them on, which is worse than either having it or not. So the whole feature
went: `pages/shared/ChatPage.tsx`, `gurukul-teacher/Communication.tsx`,
`gurukul-parent/Messages.tsx`, `components/chat/*`, `services/messageService.ts`,
`storage/chatFileUpload.ts`, the `message` entity, its ownership row, its live
domain, its query key, its two realtime subscriptions, every unread badge in
three shells, and `messages` / `communication` from `ROLE_MODULES`. The old
addresses redirect to the notices each role still receives rather than 404.

**What the school still communicates with:** announcements (school and class) and
the doubt portal. Both are live and unchanged.

**The `messages` table and its RPCs are NOT dropped.** No migration in this change
touches them. Deleting a school's message history is not a design decision to take
on the way past, and an unread table costs nothing.

**The teacher's Question Bank screen is gone; the bank is not.** `/teacher/question-bank`
was a browser over the central bank, and a teacher reaches those same questions
where they need them — picking questions for a test, and filling a paper section.
The super admin's review queue (`/admin/question-bank-review`, §10.20) stays: it is
the only thing that approves a question, and without it the bank every other
surface draws on stops being fed.

**The teachers' AI is the question-paper maker.** `TeacherAICoach.tsx` promised a
per-student diagnostic report and rendered a hard-coded example of one for a
student who does not exist — a screen that lied about having data. Deleted;
`/teacher/ai-coach` redirects to Question Papers, which builds a paper from the
bank or generates it, and pushes it to a class the teacher teaches as an online
test.

---

## Homework — RULED 2026-09-13, built, NOT APPLIED

**The specification, in the owner's words.** The teacher sets homework with "a heading/title
and the usual fields"; the question is typed text OR one uploaded file (image, document or
PDF); the teacher chooses the CLASS, sets a DEADLINE, and may SCHEDULE it. For the student,
"THERE IS NO DIGITAL/TYPED SUBMISSION": ONE FILE, an image or a PDF. The deadline closes it
automatically and every student is resolved to submitted or not submitted; nothing after it.
The teacher has EXACTLY TWO ACTIONS, accept or reject — no marks, grades or remarks — and a
REJECTED submission counts as NOT GIVEN.

Ruled the same day, on being asked: **missing homework costs the student XP**, and **the
teacher's decision reaches the family as "accepted" or "rejected"**.

**Built as six migrations, `20260925100000`–`20260925150000`, each with a rollback and a
proof block that rolls itself back if it cannot demonstrate its own effect. None is applied
to the live project** — see HANDOFF.md.

33. **The deadline is one instant: `homework.closes_at`, timestamptz, NOT NULL.** The brief
    offered "delete `closes_at`/`submission_mode`, or implement `closes_at` as the deadline".
    `closes_at` IS the deadline: a deadline is an instant, and it was already the column that
    meant "when this closes". `due_date` is now GENERATED from it — the school-local date,
    decided once in `school_local_date()` — so the routines and screens that group by date keep
    reading the column they read; `due_time` is folded in and dropped; `submission_mode` is
    dropped. (Measured before: `closes_at` had been backfilled as `(due_date + 1)` in the UTC
    session zone, so homework "due 15 Sep" closed at 05:30 IST on the 16th and `due_time` was
    ignored.)
34. **The question is typed text OR one file**, never both (`homework_question_is_text_or_file`;
    a draft may have neither yet). The question file is an image, a Word document or a PDF
    (`homework_question_file_ok`). §10.22 stands unchanged: the chapter is picked from the
    class's curriculum, the topic picked from that chapter or added, and a free-text label only
    where no chapter fits.
35. **Release.** Published now, scheduled, or kept as a draft. Scheduled work is released by
    pg_cron job `publish-due-scheduled-work` every minute (`publish_due_scheduled_work()`), not
    by page loads; students and parents read a homework only once it is published and while it
    is not deleted. **Nobody signed in can publish or schedule homework whose deadline has
    passed, or move a released homework's deadline to a moment that has** — closing it early
    would charge the class for work it still had time to do; extending it is allowed. **The
    scheduler does not release homework whose deadline passed before it ran**: it stays
    scheduled, where its teacher sees it, and a later deadline releases it on the next run. A
    closed homework cannot go back to draft or scheduled — republishing would tell the class
    "New homework" about work nobody can hand in. It can be archived.
36. **The hand-in is ONE image or PDF**, through `rpc_homework_submit` only — no session writes
    a submission row. `homework_submissions.file` is a single jsonb object, so a second file
    cannot be stored (`homework_hand_in_ok`); the file must exist in `academic-files` under the
    student's own folder. **A handed-in file cannot be overwritten or deleted** through storage
    afterwards (`homework_file_is_fixed`, 20260925140000) — before this, a student could swap
    the bytes behind an accepted hand-in.
37. **The deadline closes it for everyone.** Nothing is handed in at or after `closes_at`, nor
    once the homework is resolved. pg_cron job `resolve-closed-homework`, every minute, writes a
    `not_submitted` row for each current student of a closed homework's class, charges the
    missed-homework XP (rule 42), and stamps `resolved_at` — all together, once: resolution
    freezes the roster, so a student who joins later is not counted as having missed work set
    before they arrived.
38. **The teacher's two actions: accept or reject** (`rpc_homework_decide`), on a hand-in
    awaiting review, by a teacher of the class or an admin of the school. No marks, no grade,
    no remark exist anywhere in the model any more. A hand-in and a decision hold the homework
    `FOR SHARE`, and the closure job skips a homework held that way, so neither interleaves
    with it (proven on two connections by `scripts/local-replica/race.mjs`: without the lock a
    rejection taken as the job runs is never charged, and a student handing in again is charged
    for work they gave).
39. **Four statuses:** `not_submitted`, `submitted`, `accepted`, `rejected`, and
    `homework_submissions_state` makes each mean one thing. Lateness is not stored: nothing can
    be late. `is_late`, `grade`, `marks_obtained`, `teacher_remarks`, the typed `content` and the
    resubmission `version` are gone, and so is the second digital path (`homework_questions`,
    `homework_answers`, `homework_completions`, `rpc_close_homework`) — all three tables empty.
40. **Counting has one home.** `homework_student_status` decides a student's standing — `given`
    is submitted or accepted, `closed` is the deadline having passed — and `homework_completion`
    is its per-homework aggregate. Only published, undeleted homework counts, and a deleted
    student counts for nobody. **Completion is measured at the deadline** (§10.12): the profile,
    the leaderboard, the student snapshot and the parent digest divide by closed homework, so a
    student is not behind on work they still have time to hand in. Archived homework leaves the
    students' view and every count, as unpublished homework always has.
41. **Delete is a soft delete to the trash** (`rpc_homework_delete`), drafts and published work
    alike, by a teacher of the class or an admin; the trash restores and purges it. Everything
    read live drops at once; the stored profiles recount through the academic event queue,
    which pg_cron job `process-pending-academic-events` now drains every minute — the browser
    no longer does, and no signed-in or anonymous session may drain it or replay an event.
42. **Missing homework costs XP — RULED.** Missing means not given when the homework closes:
    never handed in, or rejected and not handed in again. The closure job charges each current
    student with an account the progression engine's own rule `homework.missed` (live:
    "Missing homework", −20 XP and −5 reputation; XP never goes below 0), once per submission
    row — the idempotency key is the row, so a second run or a later path never charges twice.
    A hand-in rejected AFTER the homework was resolved can no longer be handed in again, so
    `rpc_homework_decide` charges it on the same terms; a rejection before the deadline costs
    nothing yet. Work handed in and still awaiting review at the deadline is given, and costs
    nothing. A student who has left the school is nobody's missing work. An admin who disables
    the rule stops the cost without touching this code. A homework whose charge cannot be
    applied stays unresolved and is retried the next minute — never resolved without it.
43. **Homework released before rule 42 costs nobody** (`homework.missed_costs_xp = false`, set
    by `20260925110000` on every published or archived row, and on nothing else). It was set and
    handed in under rules with no such cost, and its typed hand-ins become `not_submitted` in
    this model — charging it would charge students who did hand in. It is resolved like any
    other homework when it closes. No teacher can write the column. Measured on live
    2026-09-13: all 19 published homework had closed; without this their first closure would
    have charged 12 students for up to 19 homework each.
44. **The family is told "Homework accepted" or "Homework rejected" — RULED — once each.** The
    router's decision branch names the two decisions and no longer routes `homework.graded`,
    which nothing emits (`20260925150000`, an in-place edit of `process_academic_event` that
    keeps its line endings and changes nothing else in it). `_notify_student_circle` now hands a
    student's parents to `_notify_student_parents`, so a parent linked both by
    `students.parent_user_id` and through `parent_students` — every legacy link — is told once,
    not twice; every other caller of the circle (remarks, badges, battles, risk alerts) stops
    doubling with it.

**Assumptions proceeded on, as the brief allowed — they are not rulings.**
* A student may replace their file, or hand in again after a rejection, only before the
  deadline. An ACCEPTED hand-in is final.
* XP for homework is awarded when the teacher ACCEPTS, not at hand-in, so rejected work earns
  nothing — exactly like work never handed in.
* "Duplicate" opens the form as new homework with no deadline, for the teacher to set one.
* **XP stays as it was applied.** Deleting or archiving homework takes it out of every count,
  but the XP accepting it awarded and the XP missing it cost are progression history and are
  not reversed — nor by a rollback. If deleting homework should refund what missing it cost,
  that is a ruling to ask for.
* The teacher is told on the review screen, once the deadline has passed, that rejecting now
  counts as missed homework and costs the student XP; the student is told "Missing it costs XP"
  on homework to do, or rejected and still open — never on homework released before rule 42.
* The teacher's form keeps a deadline the teacher did not touch to the second. The field holds
  minutes, and every legacy deadline is 23:59:59: saving an edit used to move it a minute earlier.

**What the legacy rows become (measured on live 2026-09-13).** 51 homework — 19 published, 32
archived, none scheduled, none deleted — all keep their typed question. 145 submissions — 108
submitted, 28 graded, 9 late — and **not one carries a file**, so all 145 become
`not_submitted`: typed submissions do not exist in this specification. Their content, grade and
remark are copied first into `homework_submissions_pre_20260925110000` (and every homework row
into `homework_pre_20260925110000`), which is what the rollback restores from. Decision D1 in
`docs/decisions.md` is superseded accordingly.

---

## Parked — year-end rollover

Not started. The model is being decided at product level and will arrive as its own spec. Build nothing from inference. When it arrives: write the definition first (what promotes, archives, resets, carries forward), get it ruled on, map every academic table against it, build it idempotent and dry-runnable, and test against a copy of production rather than a fixture.

---

## Frozen scope for v1

**Attendance, homework, exam marks, parent reports.** Ship to one school, then expand on real feedback.

Out of scope and not to be built, reconciled, or deployed: the ephemeral test report, all AI functions, year-end rollover.

## Lint

`npm run lint` has a **113-error / 71-warning** baseline across 582 files, all pre-existing and now all `@typescript-eslint/no-explicit-any` — the seven assorted errors beside them were fixed on 2026-09-09, three of them by an `eslint-disable` carrying a checkable reason rather than by a behaviour change to a mojibake map or a Devanagari character class. `supabase/functions/` is excluded from eslint (Deno runtime, different globals); nine of the previously-cited 143 errors were always Deno-source, so 143 was never the application's number. The baseline gate fails when the count improves as well as when it regresses — this is intended; lower it deliberately.

**`npm run lint:baseline` is a blocking CI gate as of 2026-09-09** (`.github/workflows/quality.yml`). "Lint's status is stated, not implied" still holds for a report — say the number — but it is no longer true that nothing enforces it: the debt is frozen and nothing may add to it. Bounded, and the script says so itself: totals cannot hide one fixed and one added.

## Definition of done

An item is done when: the spec clause it serves is cited in the commit message; no threshold literal was introduced; any migration is applied with its rollback and a caller-privileges assertion proving the intended role is refused *and* the intended role still works; test suite and typecheck are green and lint's status is stated, not implied; and anything unresolved is written up as a ruling request rather than guessed.
