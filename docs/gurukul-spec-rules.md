# Gurukul — standing rules

Commit to `docs/gurukul-spec-rules.md`. This file supersedes the claude.ai project file previously cited as `gurukul-handoff-prompt.md`, which was never in the repo and which two sessions were told to obey while unable to read it.

The product spec is the authority. Its numbered clauses — §4.2b, §10.8, §10.11, §10.12, §10.15, §10.18 — must be re-read before touching anything they govern. Where code and spec disagree, the spec wins and the code is the bug.

Rules 1–23 are as issued. Rules 24–27 were added 2026-09-05. Rules 12–15 and 18's second half are **parked** — see the Parked section; they describe a feature with no code.

---

## On thresholds

1. **No threshold literals.** The count is currently 0. Every boundary is a named constant in the spec's own units; consumers multiply by 100 at the display edge, never the other way round.
2. **Never gate on a rounded percentage.** `Math.round(99.6) === 100`. When the question is "did anything go wrong", ask it directly.
3. **A band is not reusable because it compiles.** Finance has `FeeCollectionBand`, exams have `ExamScoreBand`, accuracy has its own. Reusing the academic `Band` across measures typechecks, which is exactly the danger.
4. **Below-pass is not a number.** It stays a `Metric<boolean>` derived from `exams.passing_marks`, so unknown propagates instead of silently becoming a pass.
5. **Composites hide from the literal gate.** `academic = (testsAvg + examsAvg) / 2` contained no vocabulary word and so was invisible to it. Where two rates must be compared, take the worst — furthest below **its own** line — and name which one it was. Never average them (§4.2b).

## On verification

6. **A `DO $verify$` block proves nothing about access.** It runs as `postgres`: superuser, RLS bypassed. It can show a policy exists and that a predicate contains a string. It cannot show that anyone is refused.
7. **Use `npm run verify:caller-privileges`.** It impersonates real users via `set_config('request.jwt.claims')` + `set_config('role','authenticated')` inside a rolled-back transaction and catches exceptions as data. **80 assertions currently pass** (was 26). Every new guard gets an assertion here — not a `DO` block.
8. **Pair every denial with a positive control.** A first version of the probe used invalid SQL: all four insert probes failed with a syntax error and three still scored PASS, because the assertion only looked for the word `ERROR`. A refusal you cannot distinguish from a typo is not evidence. Prove the guard isn't passing hollow by breaking the feature — a school-B row refused **and** the own-school path still working.
9. **Scope denial probes to one row by primary key.** `EXISTS` over `academic_audit` (8,878 rows × `same_school()`) times out for a role that sees nothing, which made the denied case untestable.
10. **Row counts are evidence about usage, not proof of breakage.** Establish which before concluding. **See rule 24 — in this database they are mostly evidence of seeding.**

## On audience

These are the product owner's, given directly. They override any inference from code or from a §-clause read in isolation.

11. **The student's Analysis tab is fed by practice, and by nothing else.** It is a week-wise topic analysis wired directly to practice. Neither test data nor **exam/marks data** feeds it. *(Amended 2026-09-05: `Analysis.tsx:142–178` currently fetches marks and exams and computes against `exam.maxMarks`. That is the defect. Removing it will leave Analysis near-empty for a student who does not practise — that is correct and honest. The student's exam marks live on their marks surface.)*

12. *Parked — see Parked section.*
13. *Parked — see Parked section.*
14. *Parked — see Parked section.*
15. *Parked — see Parked section.*

16. **Do not "reconcile" the student's practice-derived Analysis against §10.15.** §10.15's "tests and exams only, never practice" governs the parent-facing weak-concept alerts, which do not exist. The Analysis tab is a different surface with a deliberately different source. §4.2b still stands independently: practice and test/exam rates are never blended into one figure — separate sources feeding separate surfaces is not blending.

17. **The parent's weekly report contains exactly:** that week's attendance; homework completed; homework not completed; a teacher's remark if one exists; and test marks where a test was conducted online. Marks, not the test report. Nothing else — not topics, not scores rolled into a judgement, not encouragement (§10.8). *(Verified compliant 2026-09-05: `_parent_weekly_digest` carries exactly these, `exam_marks`/`alerts`/`marks` absent, online-only filter present, scheduled at cron job 2, `30 1 * * 1` GMT = 07:00 IST Monday. Item 4 is structurally always empty because `teacher_remarks` has 0 rows — the UI is reachable at `LiveClassPanels.tsx:647`, it is simply unused.)*

18. **Visibility follows role relevance, not secrecy.** What the school issues to its students is school data; within the school it is not hidden by default, and a restriction needs a reason from the spec rather than caution. Do not restrict a role beyond the spec on your own judgement, and do not widen one either; where the spec is silent, ask. *(The principal/test-report clause is parked with rules 12–15.)*

## On spec vocabulary

19. **A class row *is* a section.** The three FKs — `attendance_submissions`, `section_subjects`, `student_enrolments` — all point at `classes`. Every "a section they teach" resolves to `teacher_teaches_class(auth.uid(), class_id)`. A genuine sub-class grouping requires a `sections` table and a ruling; do not invent one silently.

## On process

20. **Don't delete a handler to make a gap disappear.** Where a handler exists and its emitter does not, the handler is the half already right.
21. **`npm run db:types` is fixed** (verified 2026-09-05). `scripts/gen-types.mjs` has five guards — exit code, JSON body, `export type Database` marker, 20 KB floor, 20% shrink guard — then temp-file plus atomic rename.
22. **Every migration ships with a rollback and a caller-privileges assertion.** Apply with `npm run db:migrate`, confirm with `npm run db:check-migrations`.
23. **Gates before every commit:** test suite, typecheck, `db:check-migrations`. `npm run lint` is a stated-not-implied gate — see Lint below.

## Added 2026-09-05

24. **The database was seeded by direct writes, and the service layer has never been exercised.** 458 `test_attempts` were created on 2026-08-29 across 40 users, all `submitted`, none through `rpc_test_submit`. Six exams carry `results_published_at` without `publishResults` ever running; eighteen exams exist without `upsertExam`. Trigger-based emitters fired because triggers fire on any INSERT; service-layer emitters did not, because a seed never calls a service. Consequences: a service-layer emitter with 0 events is **unexercised, not dead**; a populated table is not evidence a code path works; and no frozen-scope feature has been driven end-to-end through the UI. Establish provenance before drawing any conclusion from a count.

25. **Distinguish what the school taught from what the system inferred.** A parent may see the former; the latter is not theirs. A test's topic is school data. A weak-topic inference about their child is not, and does not appear on any parent surface.

26. **Production is the source of truth for edge functions until a hash says otherwise.** 1 of 17 deployed functions had a known relationship to its repo source; two (`ai-expand-questions`, `mcp`) had no source on any branch. Date heuristics were wrong in both directions — only a content hash settles it. The verbatim production snapshot lives on `claude/edge-function-provenance`; it is a recovery artifact and is **not merged to main**, because the repo side contains work that may never have been deployed. A deploy-time hash gate is required before any function ships.

27. **A missing-data render must not read as a data-bearing render.** `TestResult.tsx` renders every question with the correct answer and a blank student response, under copy stating wrong answers were saved to the Mistake Book. It looks functional and misrepresents. Where data is absent, say it is absent.

---

## Parked — the ephemeral test report

**No code exists for any of this.** There is no `test_reports` table (143 tables checked), no generation function, no expiry logic. `rpc_test_submit` contains no expiry match. Test reports are outside the frozen v1 scope. These rules are retained as product intent and are **not binding on any session** until the feature is scheduled.

12. The test report is a separate, self-contained artifact — not an input to anything. Generated the moment the test ends, downloadable. It feeds no weak-topic surface, no Analysis tab, and no parent surface.
13. **Student** — their own data only: which questions they got wrong, which took longest. Never another student's, never the class's. **Teacher** — the class aggregate is the primary view; clicking a student's name opens that student's report, scoped via `teacher_teaches_class`. **Principal** — nothing.
14. Deliberately ephemeral. A dynamic tab opens on the teacher's panel for 24 hours; after that the page is not openable. A PDF downloaded within the window is theirs; otherwise it is gone, by design.
15. Only the marks persist, on the student profile. One-time analysis, deliberately not stored. No caching, regeneration, or archive.

**Existing precedent, and an existing defect:** `battle_reports` implements the same pattern and implements it wrong — `expires_at` with a UI gate at `BattleReportView.tsx:151` and **no collector**. One row expired 2026-08-07 is still present. Fix that before reusing the pattern.

---

## Parked — year-end rollover

Not started. The model is being decided at product level and will arrive as its own spec. Build nothing from inference. When it arrives: write the definition first (what promotes, archives, resets, carries forward), get it ruled on, map every academic table against it, build it idempotent and dry-runnable, and test against a copy of production rather than a fixture.

---

## Frozen scope for v1

**Attendance, homework, exam marks, parent reports.** Ship to one school, then expand on real feedback.

Out of scope and not to be built, reconciled, or deployed: the ephemeral test report, all AI functions, year-end rollover.

## Lint

`npm run lint` has a 134-error / 77-warning baseline across 607 files, all pre-existing. `supabase/functions/` is excluded from eslint (Deno runtime, different globals); nine of the previously-cited 143 errors were always Deno-source, so 143 was never the application's number. The baseline gate fails when the count improves as well as when it regresses — this is intended; lower it deliberately. Any report claiming "all gates green" means tests and typecheck — say so explicitly rather than implying lint passed.

## Definition of done

An item is done when: the spec clause it serves is cited in the commit message; no threshold literal was introduced; any migration is applied with its rollback and a caller-privileges assertion proving the intended role is refused *and* the intended role still works; test suite and typecheck are green and lint's status is stated, not implied; and anything unresolved is written up as a ruling request rather than guessed.
