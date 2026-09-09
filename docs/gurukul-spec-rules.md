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
23. **Gates before every commit:** test suite, `npm run typecheck` (**never** `npx tsc --noEmit` — the root tsconfig's `files` is `[]`, so it compiles zero files and cannot fail; measured 2026-09-09), `db:check-migrations`, and `npm run lint:baseline`. Since 2026-09-09 `db:check-migrations` is a real set-difference against `public.schema_migrations` over every migration file and exits 1 — it used to ask 27 hand-written marker questions, cover 27 of 414 migrations, and exit 0 either way. See Lint below for what the lint baseline does and does not prove.

## Added 2026-09-05

24. **The database was seeded by direct writes, and the service layer has never been exercised.** 458 `test_attempts` were created on 2026-08-29 across 40 users, all `submitted`, none through `rpc_test_submit`. Six exams carry `results_published_at` without `publishResults` ever running; eighteen exams exist without `upsertExam`. Trigger-based emitters fired because triggers fire on any INSERT; service-layer emitters did not, because a seed never calls a service. Consequences: a service-layer emitter with 0 events is **unexercised, not dead**; a populated table is not evidence a code path works; and no frozen-scope feature has been driven end-to-end through the UI. Establish provenance before drawing any conclusion from a count.

25. **Distinguish what the school taught from what the system inferred.** A parent may see the former; the latter is not theirs. A test's topic is school data. A weak-topic inference about their child is not, and does not appear on any parent surface.

26. **Production is the source of truth for edge functions until a hash says otherwise.** 1 of 17 deployed functions had a known relationship to its repo source; two (`ai-expand-questions`, `mcp`) had no source on any branch. Date heuristics were wrong in both directions — only a content hash settles it. The verbatim production snapshot lives on `claude/edge-function-provenance`; it is a recovery artifact and is **not merged to main**, because the repo side contains work that may never have been deployed. A deploy-time hash gate is required before any function ships.

27. **A missing-data render must not read as a data-bearing render.** `TestResult.tsx` renders every question with the correct answer and a blank student response, under copy stating wrong answers were saved to the Mistake Book. It looks functional and misrepresents. Where data is absent, say it is absent.

28. **`has_role/2` asks whether the caller is acting in a role; `has_role/3` asks whether an account holds one.** They can disagree about the same person at the same school, deliberately. Choose by the question, not by argument count. *(Because `memberships` is UNIQUE on `(account_id, school_id, role)`, one account can hold several roles at one institution; collapsing the two forms would blend them regardless of which is active. All 111 live policies use the two-argument form, which is correct — a policy always has a session. The three-argument form exists for callers that have none and know which institution they mean.)*

29. **A guard that matches a function or file body must strip comments first — in both directions.** Asserting ABSENCE, a comment naming the forbidden identifier fails a correct change: this cost two sessions over `examAvg`, in `f6e2f51` and again in `1ec1628`. Asserting PRESENCE is worse, because a comment containing the required string lets a genuinely unguarded function pass as safe. `stripComments()` in `scripts/lint-render-safety.mjs` is the implementation to copy; it blanks comment bodies while preserving line and column offsets. Pair the guard with a control proving the stripper ran — otherwise a stripper that silently fails makes every assertion around it meaningless (G11).

30. **`active_membership_id()` must never be NULL for an account holding at least one active membership.** 111 policies key on it through `has_role/2`, so a NULL is not a degraded answer, it is a total account lockout — and it presents as a fully-rendered app in which nothing works, because `src/auth/session.ts` resolves the client-side role from `memberships` directly and routes on it. Where a default must be chosen, it is `ROLE_PRIORITY` from `src/auth/session.ts:18-25`, mirrored in `public._role_precedence`; the database and the client must agree on which app the user is in. **The `app_role` enum order is not a privilege order** — it is `(admin, teacher, student, parent, principal, super_admin)` — and must never be used for this.

## Added 2026-09-06

31. **Topic is not a selection or analysis unit; chapter and subject are.** The bank holds 11,917 distinct topic strings over 21,696 questions — about 1.8 each — inconsistent in both naming and granularity, so the same teachable topic appears under several labels. Student-facing analysis is delivered at chapter and subject level, and that is sufficient.

    Unification into a canonical per-chapter taxonomy is **deferred until the bank has grown through write-back**. It is a batch data job, not app work: cluster each chapter's questions on the embeddings they already carry, name the clusters, then assign new questions by nearest-cluster similarity with a threshold, flagging anything below it rather than inventing a topic. At current volume a viable taxonomy — 15–20 questions per topic, or one bad day reads as a weakness — would yield roughly 1,000–1,500 topics against 523 existing chapters, which is not meaningfully finer. The payoff scales with bank size, not with effort spent now.

    Until then, generated questions carry `chapter` and leave `topic` NULL. Never a guessed topic string.

    *(Counts re-measured live 2026-09-06 and all three confirmed: 21,696 rows, 11,917 distinct topics, 523 distinct chapters. Note the tension to be aware of rather than resolved here: §10.9 lists topic among the tags that "keep content appropriate" and says a student sees "nothing outside their class, subject, chapter or topic". This rule does not remove topic as a stored tag or as a filter where one is already supplied — it rules that nothing may **invent** one, and that selection and analysis surfaces key on chapter and subject.)*

32. **Work is not landed until `git ls-remote` shows it.** Committing is half the guarantee; a commit on one machine is one disk failure from gone. A deploy whose source is unpushed is the same defect as a deploy whose source was never committed — `ai-expand-questions` and `mcp` reached production that way, and six sessions of schema, migration and edge-function work sat local-only for weeks the same way. Every session ends by pushing and confirming from the remote. Preflight fails if `HEAD` is **ahead** of `origin`, not only behind.

    *(Enforced by `npm run check:pushed`, which is the FIRST thing `npm run preflight` runs. It asks `git ls-remote` rather than reading `refs/remotes/origin/*` or a local `git log` — both of those answer "what did this machine last hear", and both reported everything fine throughout the incident that produced this rule. `--all` checks every local branch. A branch that DIVERGED is pushed as `<branch>-local-YYYYMMDD` and reconciled deliberately; it is never force-pushed. Being unable to reach `origin` fails too, because "I could not ask" must not look like "nothing to push".)*

    *(Measured 2026-09-07 when this was written: `claude/threshold-rulings-schema-f179b7` was **16 commits ahead** of its remote, and `claude/edge-function-provenance` — which holds the only copy of `mcp/index.ts` outside the running deployment — had never been pushed at all in eight sessions.)*

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

`npm run lint` has a **113-error / 71-warning** baseline across 582 files, all pre-existing and now all `@typescript-eslint/no-explicit-any` — the seven assorted errors beside them were fixed on 2026-09-09, three of them by an `eslint-disable` carrying a checkable reason rather than by a behaviour change to a mojibake map or a Devanagari character class. `supabase/functions/` is excluded from eslint (Deno runtime, different globals); nine of the previously-cited 143 errors were always Deno-source, so 143 was never the application's number. The baseline gate fails when the count improves as well as when it regresses — this is intended; lower it deliberately.

**`npm run lint:baseline` is a blocking CI gate as of 2026-09-09** (`.github/workflows/quality.yml`). "Lint's status is stated, not implied" still holds for a report — say the number — but it is no longer true that nothing enforces it: the debt is frozen and nothing may add to it. Bounded, and the script says so itself: totals cannot hide one fixed and one added.

## Definition of done

An item is done when: the spec clause it serves is cited in the commit message; no threshold literal was introduced; any migration is applied with its rollback and a caller-privileges assertion proving the intended role is refused *and* the intended role still works; test suite and typecheck are green and lint's status is stated, not implied; and anything unresolved is written up as a ruling request rather than guessed.
