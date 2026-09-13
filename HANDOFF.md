# Gurukul — session handoff

Written 2026-09-09, updated the same day after §4's UI landed. Read this top to
bottom before touching anything.

---

## THE TEST FLOW — 2026-09-12 session. READ THIS FIRST IF YOU TOUCH TESTS.

**Branch:** `claude/tender-goodall-kalj38` (not the branch §0 below names — that
one is from an earlier session and the worktree note with it is stale).

**The brief, in the product owner's words:** "the test flows shall be proper.
The teacher shall be properly able to give the test … the student of the
particular class shall be able to see it and submit it. As soon as they submit,
they shall see a test report … the leaderboard shall also be dynamic … the
principal shall be able to see the test and the marks each student has got …
for the admins, all the numbers of tests given in the school."

### What was found, by running it rather than reading it

The flow was built and had never been driven end to end as the real signed-in
people. Doing that — teacher creates, publishes; three students sit it and
submit, each under their own session — found the grading right and **every
report built on top of it wrong**, because `rpc_test_submit` deleted
`test_answers` as its last statement. Full measurements in KNOWN_ISSUES 46-49.
The short version:

| | |
|---|---|
| the student's own report | listed the WHOLE PAPER as wrong, their answer shown blank |
| the teacher's weakest topics | 100% wrong on every topic, for a class averaging 2 of 3 |
| the result screen's review | "your answers were not recorded", for every student, every test |
| avg seconds per question | NULL always — `time_ms` was never written by anything |
| time on the result screen | "0m" always — `time_spent_sec` was never written by anything |
| daily activity on submit | no row at all — a 42725 ambiguity, swallowed as a warning |
| a classmate's marks | readable by a student who had not sat the test |
| 3 of 5 question formats | unmarkable by the only marker that exists |

### What is now true, and where it is proven

Ten migrations, `20260920000000`–`20260921000000`, each with a rollback and an
in-migration proof block that refuses to commit if it cannot demonstrate its own
effect. Plus `probe44.sql` — the test journey as each caller, 25 claims, the
same shape as probe43's homework journey.

**NONE OF THEM IS APPLIED TO THE LIVE PROJECT.** This environment's network
policy refuses `psqxykzqfvxgsvkmgurn.supabase.co` AND `api.supabase.com` (403,
"Host not in allowlist"), so neither the app nor the Management API is
reachable. See KNOWN_ISSUES 50. **Apply them in filename order before deploying
this branch** — the app calls four RPCs the live database does not have yet.

### How the database work was verified without the database

`npm run verify:test-flow` (`scripts/local-replica/`) builds a throwaway
postgres, applies every migration in `supabase/migrations` to it — the repo's
own migrations seed a complete demo tenant, so there are real classes, teachers,
students, memberships and 21,696 bank questions to work with — and then drives
the whole journey through it as each role under RLS: **106 claims, every refusal
paired with a positive control.** It proves the SQL; it says nothing about what
the live project currently holds. 59 of 433 migrations do not apply to a bare
cluster (pgvector, pg_cron, and self-proof blocks that need live data); none of
them is on the test path, and the report tells you which they are.

### The one instruction not built, and why

"It automatically gets removed after 24 hours." The MARKS half is done and
verified (`rpc_test_submit` writes `test_marks` in the same transaction as the
grading, before any report exists, and the student profile reads it). The
DELETION half is rule 14, which this product owner withdrew on 2026-09-11 after
measuring it — and the 2026-09-12 work depends on exactly those rows: deleting
them at 24 hours would empty the student's review, the teacher's drill-down and
the weakest-topic ranking a day after every test, re-opening the defect
`20260920000000` closed. It needs a fresh ruling that also says what replaces
those three surfaces. See `docs/gurukul-spec-rules.md`, "The test flow — RULED
2026-09-12".

### 2026-09-13 — the removals and the report

Three more things the owner asked for, after seeing the panel:

* **Chat is gone from the whole product** and the teacher's **Question Bank**
  screen with it; `TeacherAICoach`, which rendered a fabricated example report,
  is deleted and `/teacher/ai-coach` redirects to Question Papers — the whole of
  the teachers' AI. See `docs/gurukul-spec-rules.md`, "Chat and the teacher's
  Question Bank are removed", and `src/gurukul-teacher/removedSurfaces.test.ts`,
  which measures it.
* **The teacher's test report was rebuilt** into
  `src/gurukul-teacher/TestReportPanel.tsx`: a leaderboard ranked by mark, a
  per-question timing breakdown (`rpc_test_question_breakdown`, migration
  `20260921000000` — the tenth, also unapplied), and a drill-down that is now
  the student's WHOLE paper with their own time on each question rather than
  their wrong answers only. Ruled in the same file under "The teacher's test
  report — what it must answer".
* **`npx tsc --noEmit` is a NO-OP in this repo.** `tsconfig.json` is
  solution-style (`files: []` + references), so that command checks nothing and
  exits 0 on code that does not compile. The typecheck is `npm run typecheck`
  (`tsc -b --force`). A session earlier in this branch reported "typecheck
  clean" from the no-op form.

### Still open on this feature

* **The principal portal is still the fixture design** everywhere except the new
  Tests section (`src/gurukul-principal/PrincipalTests.tsx`, real data). Its own
  header says so. Wiring the rest is a separate pass.
* **Cross-client liveness of the leaderboard** is now a push plus a 30s floor:
  `20260920080000` adds `test_attempts` and `test_marks` to the
  `supabase_realtime` publication and `AcademicLiveProvider` subscribes to both.
  Until that migration is applied the push half does nothing and the floor is
  all there is.
* **No browser run.** Everything above is database measurement, unit tests,
  typecheck and build. The app cannot reach Supabase from here, so no screen was
  seen rendering. Walk the five surfaces when the network allows: the teacher's
  builder (bank picker + MCQ form), the student's list, attempt, result
  (leaderboard + review), the principal's Tests tab, the admin dashboard card.

---

## 0. Where you are

| | |
|---|---|
| Worktree | `.claude/worktrees/gurukul-tier1-e2e-fixes-c0b3c3` |
| Branch | `claude/gurukul-tier1-e2e-fixes-c0b3c3` |
| Local HEAD | `13117f9` — **PUSHED AND CONFIRMED** against origin |
| Last pushed | `9daf600` |
| Supabase project | `psqxykzqfvxgsvkmgurn` |

**Do not `cd` to the main checkout.** Work inside the worktree.

---

## 1. THE NETWORK — FIXED 2026-09-09, and what it taught

**The outage is over.** github.com, api.supabase.com and
`psqxykzqfvxgsvkmgurn.supabase.co` all answer. Everything below is kept
because the failure mode is worth recognising again.

It came back FLAPPING, not cleanly: curl saw 200, the very next `git push`
died with "RPC failed; curl 55 Send failure: Connection was reset", and three
curls a minute later could not open a socket. Ten commits existed only on this
machine at that moment. `scripts/push-when-online.sh` retries until the remote
confirms the tip — it took **51 attempts**.

**It also produced 19 fake test failures.** The first evidence run scored
56 passed / 19 failed across panels, reads, writes and tier4. The tell was in
the page snapshot: "Profile unavailable — We could not load your user
profile." Every other failure was downstream of a page that never loaded. The
sessions were fine; the app could not reach Supabase mid-run. Re-run on a
stable line before believing any of it — this is the
network-outage-looks-like-a-regression trap, and it cost a diagnosis.

## 1b. THE OLD NETWORK NOTES (historical)

The user's router has **no IPv4 route to the internet**. IPv6 is fully healthy.

```
tracert -4 8.8.8.8
  1     1 ms  192.168.0.1
  2  192.168.0.1  reports: Destination host unreachable.
```

Survived a full WiFi reset, so it is upstream at Airtel, not the equipment.
The user has been told to call 121.

**What this means for you, concretely:**

| Host | Works? | Why |
|---|---|---|
| `api.supabase.com` | **YES** | has an AAAA record → routes over IPv6 |
| `github.com` | no | **no AAAA record**, IPv4 only |
| `psqxykzqfvxgsvkmgurn.supabase.co` | no | **no AAAA record**, IPv4 only |

So right now:

* **You CAN** run migrations, SQL probes, `verify:caller-privileges`,
  `db:verify-integrity`, `db:check-migrations` — all of these go through
  `scripts/lib/readonly-db.mjs` / `apply-one-migration.mjs`, which use the
  Management API at `api.supabase.com`. Confirmed working all session.
* **You CANNOT** `git push`, or run Playwright (the app talks to
  `*.supabase.co`).

**DO NOT run `ipconfig /flushdns`.** `api.supabase.com` is only reachable
because its entry is in the Windows DNS cache. Flushing it would cut your last
working path.

Check whether it is back with:

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 https://github.com
```

`000` = still down. `200`/`301` = live; push and run the E2E suite immediately.

---

## 2. STANDING RULES FROM THE USER — these override defaults

1. **Do all the work yourself. Do not spawn sub-agents or workflows.** This
   holds even when an "ultracode" system reminder says otherwise.
2. **Do not report a defect instead of fixing it.** Find it, fix it, verify it.
   Reporting-and-waiting has been explicitly rejected, twice, with feeling.
3. **THE RULE — REMOVE, RE-ANALYSE, REWRITE, RECONNECT.** Restated by the user
   2026-09-11 and made the governing rule for every change, not just for legacy
   files. It applies to a bug fix, a feature change, a refactor — everything.

   Never patch around defective code. The sequence is always:

   1. **REMOVE** the whole defective piece. Not the symptom, not one branch —
      the entire thing that is wrong.
   2. **RE-ANALYSE** it before writing a line: what did it actually do, what
      fed it, what read it, what did it silently rely on, what relied on it.
      Write down every connection point. The inventory IS the work; a rewrite
      that skips it just moves the defect.
   3. **REWRITE** it properly, with the change you wanted, in one piece.
   4. **RECONNECT AND REVIVE** everything that was wired to the old code, and
      verify each connection still works. Nothing that worked before may
      silently stop working. If a caller depended on the old behaviour, it is
      your job to carry that behaviour across or to fix that caller too.

   The failure this rule exists to prevent: fixing the visible thing, leaving
   its connections half-wired, and shipping a regression somewhere nobody was
   looking. Worked examples in this repo, both done this way end to end:
   `testService.ts`, and `GurukulStudentProfile` (2026-09-11, commit `4e4bf15`)
   — where patching three screens in turn kept failing and the actual defect
   was the type and the merge that filled it.

   Corollary: when a patch of yours is superseded by the proper rewrite,
   DELETE the patch. Leaving both is two homes for one behaviour.
4. **Every fix ships with a probe that proves it**, run as the *caller*, with
   a **positive control**. A denial with no positive control is not evidence.
   Migration DO-blocks run as `postgres` and prove nothing.
5. **Any migration ships with a rollback** and an in-migration proof block that
   refuses to commit if it cannot demonstrate its own effect.
6. **No threshold literals.** Every boundary is a named constant in the spec's
   units.
7. **Cite the spec clause in the commit message.** Spec is
   `docs/locked-decisions.md`; rules are `docs/gurukul-spec-rules.md`.
8. **NEVER run `scripts/strip-demo-tenants.mjs --apply`.** It empties the tenant
   space and there is no production project — it would destroy the only
   environment that exists.
9. **An empty surface is often correct, not a bug.** Do not "fix" an empty page
   by inventing data.
10. **Push and confirm with `git ls-remote`.** Work is not landed until the
    remote shows it.
11. If a ruling in the user's prompt contradicts what you measure, say so —
    but if they then repeat the instruction, that is their decision: proceed
    and flag it.

---

## 3. What landed this session

### Committed in `f9187a6` (local only)

**§1 branding + housekeeping**
* `src/gurukul/pages/Practice.tsx:325` — "Wisdom Campus" → "Gurukul"
* `capacitor.config.ts:5` — `appName: 'Vidyalaya'` → `'Gurukul'`
* `KNOWN_ISSUES.md` — 19 headings whose bodies said FIXED are now struck.
  **File now reads 3 open**, and only #23 is a real outstanding defect
  (the other two are a standing caveat and a housekeeping note).

**A correction worth knowing:** the 2026-09-08 audit reported KNOWN_ISSUES 6
(`learning_resources` class scoping) as open. **It was wrong.** The body says
`RULED AND FIXED`; the audit's classifier scanned for `RULED AND DONE`. The
class predicate has been in RLS since `20260905020000` and `probe9` asserts it
as the caller with two positive controls. Re-measured live and recorded.

**Two migrations, both APPLIED to the live database**

* `20260915000000_a_test_cannot_be_created_by_looking_itself_up.sql`
  `tests_insert` was `WITH CHECK (can_manage_test(id))` — a lookup of the row
  being inserted, which does not exist yet, so **every INSERT was refused**.
  Now has its own predicate over the new row's values. `can_manage_test` is
  untouched: UPDATE and DELETE use it correctly.
* `20260915010000_the_test_status_vocabulary_matches_the_app.sql`
  `tests_status_check` refused `'scheduled'` and `'archived'`, two of the four
  statuses the builder writes and offers as buttons. Widened. `'submitted'`
  kept because 72 rows hold it.

Both have rollbacks in `supabase/migrations/rollback/`.

**`src/academic/services/testService.ts` — rewritten, not patched**

Its whole write half was addressed to the pre-Chunk-7.5 schema: it sent six
columns `tests` does not have (`class_id`, `subject`, `is_published`,
`question_count`, `subject_id`, `max_marks`) and omitted both NOT NULL ones
(`section_subject_id`, `max_mark` — the real column is **singular**). Its
fallback insert repeated four of the same six, so the retry could not rescue
the first attempt.

Three more defects fixed in the same pass:
* the **principal** could create, edit, publish and delete tests (§10: the
  principal creates nothing but announcements);
* `question_count ?? 0` printed **"0 Q" against every test** in the teacher's
  list — the count is now counted from `test_questions`, as a separate
  staff-only call because that table is closed to students (G14);
* every `test.published` event went out **with no subject**.

All 30 call sites across 8 files re-checked. **`listQuestions` was nearly
broken in the rewrite** — it gates on `get()` first, handles **parent** as well
as student, and passes `_attempt_id` via `startAttempt`, not `_test_id`. Diff
against the original before you touch it.

**`probe37.sql`** — the failing test that became the passing one. Keeps the old
payloads on file so the refusal that used to be the bug is now the guard.

**`e2e-evidence/tier1-panels.spec.ts`** — 5 probes, registered in
`playwright.evidence.config.ts` (testMatch widened to `-panels`).
**WRITTEN BUT NEVER RUN** — blocked on IPv4. It fails rather than skips when
there is nothing to attempt, deliberately.

---

## 4. Gate state after the §4 UI commit

```
verify:caller-privileges .. 413 assertions   PASS   (probe40 grew to 12 claims)
db:verify-integrity ....... All checks passed
verify:chunk-files ........ 32 files, 32 clean, 0 rotted
npm test .................. 666 passed / 59 files   (questionGeneration new)
npm run typecheck ......... clean   (tsc -b --force)
npm run build ............. clean
10 lint/check gates ....... all PASS
db:check-migrations ....... 418 applied / 418 files / 0 pending   (rewritten)
lint:baseline ............. 113 errors, 71 warnings — FROZEN, and now a CI gate
```

`npx tsc --noEmit` compiles **0 files** and cannot fail — the real gate is
`npm run typecheck`, which is what both CI workflows now run. See §5.4.

---

## 5. THE IMMEDIATE TODO, in order

### 5.1 The moment IPv4 is back

```bash
git push origin claude/gurukul-tier1-e2e-fixes-c0b3c3
git ls-remote origin claude/gurukul-tier1-e2e-fixes-c0b3c3   # must show local HEAD
```

Then run the E2E suite. **Start your own Vite** — never trust a dev server you
did not start, it may be serving another worktree:

```bash
npx vite --port 8181 --strictPort &
curl -s http://localhost:8181/src/main.tsx | head -3   # confirm it is THIS tree
PLAYWRIGHT_BASE_URL=http://localhost:8181 npm run test:e2e:evidence
```

Expect 68 pre-existing tests + **8** new `tier1-panels` ones (5, plus the two
added with the report UI: the teacher opening a class report, and the student's
"Topics to revise" card on their own result). **None of the seven has ever
run** — treat their first result as a finding, not a regression.

### 5.2 §4 — Teacher test report (DONE — database and UI, see §9)

### 5.3 §5 — Question paper UI — **BUILT, minus the two AI halves**

The brief: teacher supplies the blueprint first (class, subject, chapters,
per-section type/count/marks/difficulty). MCQ bank-first via `embed` →
`match_question_bank`, generate the shortfall. Short/long generated with
answers. Answer key a separate sheet. **Only all-MCQ papers can be pushed as
online tests.**

**WHAT LANDED.** `/teacher/question-papers` (nav: Question Papers) →
`src/gurukul-teacher/QuestionPapers.tsx`, over
`src/academic/services/questionPaperService.ts`. Blueprint first: paper
(title, subject, class 6-12, duration), then sections (format, count, marks
each, difficulty, chapters). MCQ sections fill from the bank; the paper and the
answer key are two separate CSVs; an all-MCQ paper pushes out as a draft online
test. probe39 — **20 claims, all green** — holds the fence and the behaviour.

**WHAT WAS MEASURED FIRST (1a / 1b).**

* **1a retrieval — ESTABLISHED.** `match_question_bank`, as the teacher: 10
  rows, best similarity 1.0000, subject and class filters honoured, anon
  refused at the grant. Bank: 21,696 rows, **all embedded**, 21,681 usable,
  every one `question_format='mcq'`, every one carrying a chapter and a
  difficulty, 516 distinct chapters.
* **1b generation — NOT ESTABLISHED, and not establishable here.**
  `psqxykzqfvxgsvkmgurn.supabase.co` is `000` — no IPv4 route. `embed` and
  `ai-gateway` are both unreachable. Separately, and this survives the network
  coming back: **`ai-gateway` has no capability that generates questions.** It
  exposes `teacher.question_paper.plan`, `.generate_outline` and
  `.marking_scheme`, and all three declare `generates_full_paper: false`.

**THE DEVIATION, STATED.** The MCQ fill is a STRUCTURED query — class level,
subject, chapter, difficulty — not a vector search, because `embed` cannot make
a query vector from this machine and a section is a structured query by nature.
The semantic path is a widening of `rpc_fill_paper_section_from_bank` once
`embed` is reachable, not a different function and not a different service
call. Every fill returns `shortfall`, the screen prints it, and that number is
the brief's "generate the shortfall" with nothing behind it yet.

**GENERATION IS NOW BUILT — AND CANNOT BE VERIFIED FROM HERE.**

`teacher.question_paper.generate_questions` is a real ai-gateway capability:
MCQ, short and long, each with its answer, quality-guarded, with the shortfall
and every rejection reported. The Generate control is on every section of the
paper screen. **None of it runs until `ai-gateway` is deployed**, and that is a
decision rather than a step — see §5.5.

The prompt, the schema, the per-format token budget and the quality guard live
in ONE place: `supabase/functions/_shared/questionGenerator.ts`, mirrored from
`src/academic/ai/questionGeneration.ts`. **The pair is gated** — a vitest
comparison strips comments from both copies and fails on any drift, with a
control that fails if the comparison is reading an empty string.

`dpp-generate-questions` already had all of this inline, reachable by that one
function; it now calls the shared module, so there is one description of a good
question rather than two. It also gains the quality guard it never had: a
three-option MCQ, an answer key pointing past the end of the options, and a
one-word "short answer" all used to reach the caller unchallenged.

**THE WRITE-BACK IS DONE.** A generated MCQ goes onto the paper AND into the
shared `question_bank`, tagged `source_type='ai_generated'`, credited to its
author, `topic` NULL (rule 31), and `is_approved=false` — passed explicitly,
not left to the column default, because a product rule that holds only because
of a default stops holding the day someone changes the default. probe40 holds
all eleven claims.

Two things the write-back cannot do, both measured rather than assumed:

* **Written-answer questions cannot go back at all.** `question_bank.options`
  and `.correct_index` are both NOT NULL, so the bank structurally holds MCQs
  only — even though `question_bank_question_format_check` admits 'short' and
  'long'. The vocabulary anticipates them and the columns forbid them. Short
  and long questions stay on the paper and the screen says so.
* **An unkeyed question is never written.** `question_bank_active_must_be_keyed`
  refuses an active row with no `chapter_id`, so the section's chapter NAME is
  resolved to a curriculum chapter id through `CurriculumService`; a name that
  resolves to nothing is skipped with that as the printed reason.

Approval is not the author's to give: `trg_question_bank_approval_is_super_admin_only`
refuses it to everyone but a super admin (§10.20), which is exactly what makes
an unapproved contribution safe to accept.

**THE SEMANTIC PATH IS BUILT.** `rpc_fill_paper_section_from_bank` now takes
an optional ORDERED LIST OF BANK IDS. Given one it draws from those ids in
that order; given none it behaves exactly as before. One function, two ways of
choosing which questions come first — which is what `20260916050000`'s header
promised.

The ids come from `ai-gateway`'s `teacher.question_paper.match_questions`,
which embeds the section blueprint through `resolveQueryEmbedding` and calls
`match_question_bank`. **It returns IDS ONLY**, never rows: that RPC runs with
the SERVICE ROLE and bypasses RLS — it re-states the board test in its own body
for exactly that reason — so handing rows back would make the endpoint a
service-role read of the question bank.

**THE PROPERTY THE WHOLE THING RESTS ON**, and probe41 is eleven claims about
it: the fill RPC re-applies every one of the section's own filters — subject,
chapter, difficulty, class level, board, not-already-on-this-paper — AS THE
CALLER. A ranking can reorder what a teacher may retrieve; it cannot widen it.
Measured: a list of ids for the wrong subject, the wrong class, the wrong
chapter and one junk uuid inserts **nothing**, while the same section still
fills three from its own chapter.

When there is no embedding provider the gateway returns `embedding_unavailable`
and the fill proceeds structurally — and the screen SAYS which path ran. A
structured fill dressed as a semantic one is a claim nobody made.

**A PERFORMANCE FINDING, not fixed:** `question_bank` has **no vector index**
at all — measured, zero indexes mentioning `embedding`. Every semantic lookup
is a sequential scan computing `<=>` over 21,696 rows. It works and it is
correct; it will not stay cheap. An ivfflat or hnsw index is a migration
nobody has written.

**STILL OPEN on this feature:** letting the bank hold a written-answer question
at all — `options` and `correct_index` are NOT NULL, so that is a schema
decision about a 21,696-row shared table, not a code change.

### 5.5 THE DEPLOY — DONE 2026-09-10, ai-gateway v27 -> v28

Deployed on the user's explicit instruction, after the cost consequence was put
to them twice. `npm run functions:deploy-gateway`.

**WHAT SHIPPED.** The repo was ahead of production on every file that mattered,
so this closed four real gaps at once:

* the **§10.8 fix** — production had been emitting `"Stronger areas: …"` to
  parents, which the spec forbids anywhere in the app. `parentNarrative.ts` is
  reached only through `aiRouter`, which only `ai-gateway` bundles, so this is
  now gone from production entirely;
* the **S-04 tenancy fix** in `embeddingWorker` — production could clear an
  embedding claim belonging to another school. `embeddingWorker` is imported by
  `ai-gateway` alone, so likewise fully closed;
* the **S-05 parent-school fix** — a parent's school now resolves from the NAMED
  child through both linkage tables, and is refused rather than falling through
  to an unrelated child's school;
* `teacher.question_paper.generate_questions` and `.match_questions`, without
  which §5's generation and semantic fill did not run at all.

**VERIFIED AS THE CALLER, with a negative control.**

| check | result |
|---|---|
| function version | 27 -> **28**, ACTIVE |
| unauthenticated POST (negative control) | `401 {"error":"Not authenticated"}` — a boot/import failure would be a 500 here |
| deterministic capability (`student.homework.due`) | `200 answered_deterministic`, `used_model:false` |
| generative capability (`student.nova.chat`) | `200 answered_model`, `used_model:true`, `model_id qwen/qwen3.7-flash`, and a correct answer about why ice floats |
| `check:edge-drift` | ai-gateway findings 11 -> **0**; baseline lowered 17 -> 6 |

**THE COST CHANGE, AND THE LEVER THAT UNDOES IT.** Production had been routing
to free Nemotron first with Qwen as the paid fallback. The repo implements the
2026-09-07 one-model ruling, so ai-gateway now bills Qwen on every generative
call. That is the ruling being applied, not a regression.

It is **not** a code change to reverse. `modelRouter` reads both models from the
environment and runs its two-stage path whenever they differ
(`hasDistinctFallback()`), so setting two function secrets restores free-first
with a paid fallback, with no redeploy:

```
OPENROUTER_PRIMARY_MODEL = nvidia/nemotron-3-ultra-550b-a55b:free
OPENROUTER_MODEL         = qwen/qwen3.7-flash
```

Left unset, both resolve to `qwen/qwen3.7-flash` and the second stage is skipped
rather than calling the same model twice and billing for it.

**WHAT IS STILL ADRIFT, and it is not nothing.** Six accepted findings remain,
in functions this deploy did not touch:

* `ai-expand-questions` — 5 shared modules, including **the OLD two-model
  `modelRouter`**. That function therefore still uses the free Nemotron tier
  while ai-gateway no longer does. Deploying it would move it onto paid Qwen too;
* `dpp-generate-questions/index.ts`.

Because `_shared` is snapshotted per function at deploy time, every function
carries its own copy — see the `shared-modules-are-per-function-snapshots` note.
Deploying one never updates another.

---

## 6. §4 — SPEC CONFLICT, AND THE DECISION TAKEN

**`docs/locked-decisions.md` §10.25 Reports** (line 727) says the Test report is

> Class average · weakest topics ranked · average time per question
> Full student list with marks
> Tap a student → their actual wrong answers, with the topic on each
> **Generated automatically as soon as grading completes**
> **Visible to:** teacher · **principal** · the student themselves ·
> **parent, for their own child's part only.**

**The user's brief contradicts this**: *"Student sees their own data only.
Principal sees nothing"*, and demands an assertion that the principal is
*refused entirely*. The brief is also silent on the parent, whom the spec
grants their own child's part.

**Decision taken (user said "start your work" rather than ruling):** build
**fail-closed to the user's brief** — principal refused, student own-data-only
— but put the entire role set behind **one named SQL function** so widening it
to the spec's rule is a one-line migration, not a re-architecture.

**If the user rules for the spec later, the change is:** edit that one function
to admit principal and parent-of-that-child, and flip the corresponding
assertions in the probe. Nothing else moves.

Two more points the next session should not re-derive:

* **"Report is ephemeral, marks are durable"** does *not* mean the answers
  expire. §10.8's exception and §10.23 make test answers **school data** that
  persists permanently, and §10.25 requires "their actual wrong answers" on
  tap — which needs durable per-question data. The ephemeral part is the
  *generated artifact* (aggregate + any AI narrative), exactly like
  `battle_reports.report` + `ai_insights` with `expires_at`. Follow that
  precedent — see `20260905100000_battle_reports_collector.sql`.
* **Marks must be written to the student profile before anything expires.**
  That ordering is the user's explicit requirement.

### What §4 needs, per the user's brief

* Class aggregate is the primary view, scoped via `teacher_teaches_class`.
* Click a student name → that student's individual report.
* Generated when the test ends. Downloadable.
* Assertions required: teacher refused another class's report; student refused
  another student's; principal refused entirely; **each still able to reach
  their own** (the positive controls — without them the refusals prove nothing).

### Ground truth you will need

There is **no teacher-side test report of any kind today.** `TestService` has
`getMyAttempt` (own) and `listLatestAttemptsForStudent` (used only by the
*parent* panel). Nothing lists a class's attempts.

Live data, measured 2026-09-09:

```
tests 72 · test_attempts 458 · test_questions 576 · marks 2546 · students 223
```

**All 72 tests belong to school B** (`...0002`), spread over 6 duplicate class
rows all named "10". The QA student is in school A (`...0001`), class
`d2000001-0001-4000-8000-000000000001`, which has **0 tests**. The user has
said explicitly: **ignore the duplicate classes.** Do not chase that.

Useful ids:

```
school A          00000000-0000-4000-8000-000000000001
class 10-A        d2000001-0001-4000-8000-000000000001
teacher (Priya)   priya.sharma@wisdomcampus.com   teaches 10-A, 9-A, 12-A
QA student        qa.automation@wisdomcampus.com  user da000000-0001-4000-8000-000000000001
admin             admin@wisdomcampus.com
principal         principal@wisdomcampus.com
section_subjects on 10-A: Physics, Mathematics
```

---

## 7. Traps that have already cost hours — do not re-learn these

* **A view without `security_invoker=true` runs as its OWNER**; RLS on its base
  tables never applies. `attendance_day_edits` is the one deliberate exception
  and both fences live in its body.
* **A CHECK constraint passes when its expression is NULL.** Every branch must
  lead with a test that is FALSE, not NULL, when it does not apply.
* **CHECK constraints cannot contain subqueries** — use a BEFORE INSERT/UPDATE
  trigger when you need a lookup.
* **An RLS predicate that re-queries its own table** breaks INSERT and
  `INSERT … RETURNING` with a misleading 42501. This bit `exams_read`,
  `students_read` and `tests_insert`.
* **`information_schema.role_table_grants` hides grants.** Do not audit with
  it — KNOWN_ISSUES 5.
* **Bash heredocs mangle backslashes.** Use the Write tool for anything with
  regex literals.
* **`qwen/qwen3.7-flash` is a reasoning model** — send
  `reasoning: { enabled: false }` or it burns the whole `max_tokens` on the
  internal trace and returns `content: null`.
* **An OpenRouter 429 is not an outage.** It clears on its own.
* **Playwright orders spec files alphabetically** and that ordering is
  load-bearing: `aa-reachability` must run first, `zz-known-issues` last
  (it mints its own sessions and kills the shared ones).
* **A migration DO-block runs as `postgres`.** It proves nothing about what a
  teacher or student can do. Use `verify:caller-privileges`.

---

## 8. Commands

```bash
npm test                          # 636 unit tests
npm run typecheck                 # the REAL typecheck
npm run lint                      # 120 errors, pre-existing
npm run build
npm run verify:caller-privileges  # 340 assertions, as the caller
npm run verify:chunk-files        # 32 verification files
npm run db:verify-integrity
npm run db:check-migrations       # set difference vs public.schema_migrations
npm run lint:baseline             # frozen at 113/71; fails if the totals move
node scripts/apply-one-migration.mjs supabase/migrations/<file>.sql
npm run test:e2e:evidence         # needs IPv4 + your own Vite
```

---

## 9. §4 STATUS — database layer DONE, UI NOT STARTED

### Landed and applied

| Migration | What |
|---|---|
| `20260916000000_a_teacher_can_finally_see_how_the_class_did.sql` | `can_read_test_report`, `can_read_test_student_report`, `rpc_test_class_report`, `rpc_test_student_report` |
| `20260916010000_the_class_list_reads_the_roll_number_where_it_lives.sql` | corrective — `roll_number` is on `students_current`, not `students` |
| `20260916020000_the_answer_key_walked_around_its_own_grant.sql` | **security** — the student branch of the fence, and the empty-attempt payload |

`probe38.sql` — 28 assertions, all green. **Suite is 370/370.**

### TWO FIXTURE TRAPS THIS COST ME — do not repeat them

1. **`teacher_teaches_class(_uid,_class)` cannot be evaluated from a session
   that is not that user.** It branches on `_user_id = auth.uid()` and calls
   `same_school()`, both session-dependent. Called as `postgres` it reports
   "teaches nothing" for every teacher alive. The first probe38 picked its
   outsider that way, landed on a teacher who *does* teach 10-A, and reported
   a **security leak that did not exist**. Pick probe fixtures from the RAW
   TABLES (`teacher_classes`, `teachers.class_teacher_of`).
2. **All three school-A teachers are linked to 10-A**, so "a teacher who does
   not teach this class" does not exist for 10-A. **12-A separates them** —
   Priya teaches it, Rajesh does not (probe9 uses the same split). 12-A holds
   only ONE student, so student-vs-student claims must stay on 10-A.

### The UI — DONE, and the disclosure found while wiring it

1. `TestService.classReport` / `TestService.studentReport` — thin wrappers over
   the two RPCs, beside `countQuestions`. **No role check in either**, and the
   comment says why: `can_read_test_report` is the only home for that rule and
   it is expected to change (see below).
2. Teacher: a **Report** control per row in `LiveTestsTab`. Class average,
   submitted count, average seconds per question, weakest topics ranked, then
   the full class list with every student clickable into their drill-down.
3. Student: a **Topics to revise** card on `TestResult.tsx`, from the same RPC.
   Deliberately NOT a second per-question renderer — the review below it
   already walks the paper; the report is those wrong answers collapsed onto
   the topics they fell in, which is the half a student can act on.
4. **Downloadable** — CSV on both, via `@/lib/exportCsv`. That function used to
   live in `gurukul-admin/shared` and is now one implementation for every
   portal, re-exported there so no admin import site moved. Row shaping is in
   `src/academic/services/testReportSheets.ts`, shared by both screens.
5. `e2e-evidence/tier1-panels.spec.ts` extended with two more probes. **Written,
   never run** — IPv4.

**THE DEFECT THIS WORK FOUND, and it was live.** Wiring the drill-down meant
asking what `their_answer` renders as, and the answer was: for a student who
had not sat the test, the whole paper. `can_read_test_student_report`'s student
branch checked only "is this MY student row" and never what `_test_id` had to
do with that student, and `wrong_answers` came from a LEFT JOIN that matches
EVERY question when there is no attempt. Measured as the caller:

* a school-A student read all **8 questions of a school-B test with their
  correct answers**, while the same student's direct `SELECT` on `tests` and on
  `test_questions` each returned **0 rows** — a SECURITY DEFINER function
  walking around both the tenancy fence and the G14 grant;
* and on their own class's published test, the full key before sitting it.

Closed by `20260916020000` in two places on purpose — the fence now requires a
submitted attempt of their own, and the body returns `[]` plus a new
`submitted` boolean rather than the paper. probe38 claims 11-14 hold both ends,
with the sitter's own report as the positive control.

`answerToText` (`src/academic/services/answerText.ts`, 10 unit tests) is the one
decoder for "what does this answer payload say" — an answer is a POSITION and
needs its option list, which is why `options` now travels with each wrong
answer. `TestResult` uses it too, so the two screens cannot drift apart.

### RULED, 2026-09-09 — do not re-open this

Asked directly, with §10.25's wording and the build instruction's wording side
by side, the user ruled:

> "Admin and Principal sees nothing. Teacher get a test report. Student get
> their own reports plus leaderboard. Parents get their own child reports."

That is neither option that was on the table. Applied by `20260916030000`:

* **the office is out.** `can_read_test_report` lost BOTH its `has_role(admin)`
  branch and its `created_by` branch — the second is the first with a different
  key, and a rule saying "the office sees nothing" with an authorship exception
  is not the rule that was given. The fence is now exactly "the teachers who
  teach this section". §10.20's super-admin support access is refused too, and
  that is fail-closed and one `OR` from being reopened if support needs it.
* **the parent is in, for their own child alone** — through
  `my_children_student_ids()`, which already resolves both guardian linkages,
  and never through `rpc_test_class_report`, which is every other family's
  marks. Same "must have sat it" condition as the student, so a parent cannot
  read the paper before their child does; that condition is now
  `_test_was_sat_by()`, written once and shared by both branches.
* **the student's leaderboard** is `rank` + `class_size` on their own report:
  a POSITION, with no other child's name or mark in the payload. If a NAMED
  leaderboard was meant, that is a widening of that one field and a disclosure
  decision — ask before building it.

probe38 claims 15-19 hold all three, each with its positive control. Suite
**370/370**.

UI: the rank is on `TestResult`; the parent's copy is a Report control per test
in `ParentLiveExams` (`src/gurukul-parent/ParentLiveAcademic.tsx`), offered only
where there is a submitted attempt, because the RPC correctly refuses the rest.

---

## 10. THE v2 STUDENT PANEL REDESIGN — 2026-09-10 session

Source document: `C:\Users\Tarun\Downloads\student-panel-redesign-v2.md`.
Sixteen commits, `3679d9b` .. `d4c6296`. Everything below is done unless it says
otherwise.

**None of them are pushed.** github.com was unreachable for the whole session —
IPv4 down at the router, IPv6 healthy, which is why every database gate could
still run against `api.supabase.com`. `scripts/push-when-online.sh` is retrying
and lands them the moment the line returns. Confirm with `git ls-remote` before
believing it.

### Done

| Item | What landed |
|---|---|
| G1 service names | 11 sites, incl. 3 the document had not found (admin reports, principal loading label) |
| G2 branding | Practice eyebrow + `capacitor.config.ts` (previous session) |
| G3 flat sidebar | Six links, no submenus, Chat cut from nav (route survives) |
| G6 "1 mistakes" | `src/lib/plural.ts`, 14 sites across 9 files, 5 unit tests |
| G7 thin data | `MIN_ATTEMPTS_FOR_ACCURACY = 5` + 2 helpers + 7 tests; applied to the Topics tab |
| G5 accuracy | ONE source. Fixed TWICE — the second time is the real one: Home and Analysis were counting different populations (`question_attempts` vs `concept_mastery`, 17% vs 63% for one student). Both now count `question_attempts`. 5 guard assertions |
| Screen 1 Home | Subject Performance + Recent Achievements out, with 8 dead imports behind them |
| Screen 2 Practice | Resume Session band out (see the caveat below) |
| Screen 3 Nova | chips, Jump-to, 6 admin prompts, ContextPill out; intro + prompts rewritten; mojibake and 💋 fixed; **question context now shown and auto-asked** |
| Screen 4 Battleground | Featured Battles + Daily + Championship out |
| Screen 5 Learning | bottom charts out |
| Screen 6 Analysis | exam readiness out; accuracy fixed; study hours → em dash |
| Screen 7 Recovery | both filter rows + priority badges out |
| Screen 8 Revision | all six removals |
| Screen 9 Mistake Book | 4 stat boxes + Add to Recovery out; **Explain** added; 3 chip rows → 1 |
| Screen 10 Class | bottom widgets + Achievements card out; subtitle rewritten |
| Screen 11 Notifications | **duplicate EMISSION found and fixed** — see below |
| Screen 12 Profile | rebuilt: 4 averages out, real marks/counts in, Rep explained |
| Screen 13 Dropdown | Leaderboard, Analysis, Achievements out |
| Screen 14 Calendar | legend + header; **data fixed** (3 demo rows, Gandhi Jayanti) |
| Screen 15 Doubts | timestamps fixed |
| Screen 16 Attempt | save state, submit confirmation, **no app chrome during a paper** |
| Screen 10 HW figure | the disputed "0 Pending HW" vs "0 / 10" settled — the stat is right |
| Resources empty state | already honest; no change needed |

### `is_my_student_record` needs an ACTIVE MEMBERSHIP — measured, and NOT a defect

Found 2026-09-11 while writing probe42, by a positive control failing.

```sql
is_my_student_record(_id) =
  _id IS NOT NULL
  AND active_membership_role() = 'student'
  AND _id = active_local_person_id()
```

No membership → NULL → **every policy keyed on it denies**. It gates five
surfaces: `fees`, `homework_answers`, `homework_completions`,
`homework_submissions`, and the function `can_read_test`.

Coverage, measured:

| | |
|---|---|
| students with a sign-in account | 52 |
| …holding an active student membership for their own row | **12** |
| …without one | **40** |
| of those 40: have ever signed in | **0** |
| of those 40: have a legacy `user_roles` row | **0** |
| of the 12: have signed in | 7 |

**So the 40 are seeded fixtures with accounts nobody has ever used, not live
students locked out of their own homework.** Memberships are granted by
invitation (`_grant_membership`, `rpc_invite_member`,
`rpc_respond_to_invitation`) — there is no trigger on `students` that makes one
— and all 12 were created on 2026-08-25 in one pass. Backfilling the other 40
would grant access to dormant accounts and bypass the invitation flow the design
routes membership through. **Do not backfill** (rule 9).

What this DOES mean for any future probe: a probe that picks a student with
`ORDER BY s.id LIMIT 1` will usually pick one of the 40, and then every refusal
it asserts passes vacuously. Select on the membership, as probe42 now does.

### Five places the DOCUMENT was wrong, all measured

1. **G4 blank icons.** Not "two missing imports". All five sites use one symbol,
   `BarChart2`, and it is fine: the ESM barrel resolves it, it renders 370
   characters of valid SVG through react-dom/server, and no CSS hides it.
   `--color-physics` IS defined (theme.css:57). **Not reproducible without a
   browser — still open.**
2. **Screen 16 question palette** — "does not exist and is the single most
   important missing element". It exists; it landed in 52ed420.
3. **Screen 15 teacher marker** — "add a visual marker". It is already there.
4. **Screen 12 parent phone** — "zero phone numbers in the database". 10 of 223
   students have one.
5. **Screen 3 prompt count** — "says eight, lists six". Both halves right: the
   array held 8, six were administrative, two were already learning prompts.

### The notification find — the biggest thing in this session

`_notify_student_parents` notified the parent down BOTH the legacy
`students.parent_user_id` column AND the `parent_students` join table. 933 of
2,867 rows surplus (33%), still happening the day before this session, every
alert type doubled, all to a parent account. `db:verify-integrity` GUARANTEES
the overlap. Fixed in `20260918000000`, probe39, 5 claims.

### Still open, and why

* ~~**G4 blank icons**~~ — **FIXED 2026-09-11, commit `225dc6e`.** Every cause
  disproved here was true and beside the point. The icons were never blank: they
  were stroked in INHERITED near-black on chips whose background had silently
  gone transparent, under `opacity-40`.

  The theme carries two token shapes that are indistinguishable as strings —
  `--primary: 193 68% 28%` (a triplet, needs `hsl()`) and
  `--color-physics: hsl(197 70% 40%)` (already a colour). The render layer built
  `hsl(${color})` for both, and `hsl(hsl(197 70% 40%))` is not a colour, so the
  declaration is dropped and the property inherits.

  Measured in the browser **inside `.gurukul-student`** — the tokens are scoped
  there, not on `:root`, which is why a first probe on the sign-in page proved
  nothing and was thrown away:

  | built | computed |
  |---|---|
  | `hsl(var(--primary))` | `rgb(23,99,120)` correct |
  | `hsl(var(--color-physics))` | `rgb(14,30,37)` = inherited |
  | `hsl(var(--color-physics) / 0.1)` | `rgba(0,0,0,0)` transparent |
  | `var(--color-physics)` | `rgb(31,133,173)` correct |

  Fixed by making every stored colour a COMPLETE CSS colour and removing all 30
  wrap sites; `withAlpha` now uses `color-mix`, having previously returned a
  `var(--color-x)` string unchanged and silently dropped the alpha. Guarded by
  `src/lib/colorAlpha.test.ts` (8 assertions incl. a structural scan), verified
  to fail when a wrap is reintroduced.

  Worst case found: Dashboard's session ring picked its colour by band and
  wrapped all three — it drew correctly at and above target and vanished below
  it, the one case a student needs to see.
* ~~The practice timer records nothing~~ — **that diagnosis was wrong and is
  corrected in KNOWN_ISSUES 44.** The finish RPC works: all four sessions it ran
  on are internally consistent. Only four practice sessions have ever been
  completed through the app; the other 258 are seeded. No fix needed, and
  deliberately no backfill — see the entry for why.
* **`config.resumeSessionId` is dead** — ~110 unreachable lines in the practice
  engine. Documented at the field. Wants a browser to remove safely.
* **Screen 1 header cluster** — the document says the reduction "is not yet
  decided".
* **Learning-loop canonical sequence** — Home and Learning name it differently.
  Blocked on a ruling; both left as they were.
* ~~**Recovery sources**~~ — **RULED 2026-09-11: practice attempts only.**
  **No code change was needed, and adding the obvious filter would have broken
  it.** Measured before touching anything:
  * `rpc_student_recovery_zone` reads `concept_mastery` and
    `recovery_assignments`, and has no source filter in its body.
  * `concept_mastery` is practice-fed: it is written only by
    `_upsert_concept_mastery` and `_recompute_concept_confidence_for_session`,
    `rpc_test_submit` never touches it, and there are no triggers on
    `test_answers` or `question_attempts`.
  * `recovery_assignments.source_type` is **not** a practice/test/battle
    discriminator. The app writes `deep_link`, `weak_concept` and
    `practice_session` — all three practice-derived. The `practice=17` rows in
    the table are seed data using a fourth spelling.
  * There is **no writer anywhere** that creates a recovery assignment from a
    test or a battle. The rule holds structurally, by absence.

  So a `WHERE source_type = 'practice'` filter — the obvious way to "enforce"
  this — would drop `deep_link` and `weak_concept` and empty the screen. **Do
  not add one.** If tests or battles are ever admitted, that is a new writer,
  not a loosened filter.
* ~~**Fees**~~ — **RULED 2026-09-11: the student sees it**, full payment history
  including outstanding and overdue. **It was already built** — I first wrote
  "no route" here and that was wrong: `StudentDashboard.tsx:357` routes `fees`
  to `src/pages/shared/MyFeesPage.tsx`, which reads `public.fees` directly and
  already renders history ordered by month, an outstanding total, and an overdue
  count derived as `status <> 'paid' AND due_date < now()`. I missed it because
  I read a truncated route listing — the exact mistake §0 warns about. The
  `fees` table has 14 columns, correct RLS, a status trigger, and **zero rows**,
  so the screen renders an honest empty state (rule 9).

  What was genuinely missing is now added: **probe42**, 6 claims, because the
  RLS had never been probed and one of the five policies (`fees teacher read`)
  is granted to `public` rather than `authenticated` — the shape that has
  produced anon holes here before. It inserts its own fixtures and rolls them
  back, since a zero-row table would satisfy every refusal vacuously.
* **Screen 17 "After expiry" — NOT BUILT, and should not be built as written.**
  The document says the test report is ephemeral, that after the window closes
  the screen shows marks only, and that the question list AND the leaderboard go
  with it. Measured: there is no `expires_at` on any test table and no purge
  function for test answers — `battle_reports.expires_at` is the battle one,
  which is practice under §10.8. And the spec says the opposite for tests:
  §10.23 makes test answers school data that persists ("a teacher set them and a
  mark is the point"), and §10.25 requires "their actual wrong answers, with the
  topic on each" on tap, which needs them kept. Building the expiry would delete
  school data the spec preserves and empty the drill-down §10.25 requires.
  **This needs a ruling, not code.**
* **The 13 undesigned screens** — the document itself calls this a separate pass.
* **`useBattlegroundData` still blends** test+practice accuracy. The 10 Sept
  ruling is scoped to Analysis; widening it is a product decision.

### Rule correction — MADE 2026-09-11, on the product owner's ruling

Rule 13 in `docs/gurukul-spec-rules.md` now reads: **marks and rank are shared
within the class; per-question detail is private to each student.** The old
wording ("their own data only … never the class's") predated the test
leaderboard and was too broad — a rank is a position among classmates and cannot
be shown without comparing to them. `rpc_test_student_report` already implements
exactly the corrected rule: it returns `rank` and `class_size` as positions and
no other student's name or mark.

**Rule 14 is WITHDRAWN in the same edit** — the Screen 17 expiry, ruled against
after it was measured. See below.

### Screen 17 "after expiry" — RULED 2026-09-11: do not build it

The design document's ephemeral-report clause is withdrawn rather than
implemented. The spec already says the opposite (§10.23 makes test answers
durable school data, §10.25 needs the wrong answers on tap), nothing expires a
test report today, and building it is the far more complex path: an `expires_at`
column, a purge function, a cron entry, a guarantee that marks reach the profile
BEFORE deletion runs, a marks-only fallback on two panels, and probes for each —
against zero new code for leaving it durable. The product owner ruled on exactly
that trade. `docs/gurukul-spec-rules.md` rules 12–15 are updated and the section
is unparked.

---

## 11. STUDENT PANEL UI — 2026-09-11 session

Five commits. Everything below was measured, not assumed.

### What shipped

| commit | what |
|---|---|
| `e5ad6ab` | never-played students show `—`, not `0%` accuracy (ruling 8) |
| `40c2fe7` | `NoStudentProfile` — one design for 9 copies across 4 treatments |
| `c0cfc45` | `EmptyState` page/section variants — 13 sites, 5 conventions collapsed to 1 |
| `1fd33a5` | `LoadingState` — 19 sites, 18 hand-rolled blocks, now with `role="status"` |
| (last) | `StudentErrorState` + a retry that actually re-fetches, on 3 screens |

### THE BIG ONE — the student panel is TWO HALVES, built to different standards

This is the real answer to "the design isn't finished", and it is NOT fixed.

    src/gurukul/pages/            22 screens   spinner + label, no skeletons,
                                               no shared error state until today
    src/pages/student/ + shared/  13 screens   real skeletons (StudentPanelStates),
                                               aria-busy, error state with retry

BOTH are routed from `src/pages/StudentDashboard.tsx` and both render inside the
same `.gurukul-student` wrapper, so a student crosses between them constantly —
Practice is a spinner, PracticeSessionResult is a skeleton.

`src/components/student/StudentPanelStates.tsx` is the better library and has
been there all along: `StudentDashboardSkeleton`, `StudentListSkeleton`,
`StudentAnalyticsSkeleton`, `StudentSessionSkeleton`, `StudentErrorState`. Used
by 13 files. The gurukul half used NONE of it until this session.

**Decision needed from the owner**: adopt skeletons across the gurukul 22, or
accept the spinner there. Do NOT do it mechanically — a generic skeleton is
barely better than a spinner; each one has to match its screen's real layout,
which is 16 bespoke pieces of work and cannot be verified without a browser.

### THE SHADOW PALETTE — measured, deliberately NOT fixed

`src/gurukul/pages/` + `components/` carry **155 raw hex colour literals across
17 distinct colours**, alongside a complete `--color-*` token set in theme.css.

    #3b5bdb  57    #cc5069  23    #c08a3a  23    #4aa87a  15
    #6882e8  11    #4b9fd4   7    then a tail of 10 colours, 14 uses total

The hexes are NOT equivalents of the tokens — they are systematically lighter:

    --destructive: 1 37% 48%   = #A84F4D   vs the hex #cc5069
    --success:   161 46% 33%   = #2D7B62   vs the hex #4aa87a
    --warning:    35 68% 36%   = #9A661D   vs the hex #c08a3a

So a bulk swap would visibly change the panel. **Do not do it blind.** G4 was
exactly this shape. The two provable sites were fixed this session: Notices and
Notifications rendered their error line in `#cc5069` while four sibling screens
used `text-destructive` — same semantic element, different colour.

### Dead exports in `gurukul/components/shared.tsx`

Confirmed unused ANYWHERE in `src/`: `AnimatedIcon`, `HoverCard`, `TagWithIcon`,
`ListItem`, `ProgressRing`, `StatusBadge`. Also `PageHeader` and `Skeleton` —
these two are dead *in this file*; all 17 `<PageHeader` uses import from
`@/components/ui-bits` and the only `<Skeleton` user imports shadcn's. Note
`shared.tsx`'s `PageHeader` is dead for a GOOD reason: `Layout.tsx` renders the
page title itself (`headerTitle`), so screens correctly do not repeat it.

### Browser verification is OWED

Nothing in this session was seen in a browser. `psqxykzqfvxgsvkmgurn.supabase.co`
does not resolve (DNS times out), so the app cannot sign in, and
`api.supabase.com` only survives on a cached entry. 1.1.1.1 and 8.8.8.8 are
unreachable by IP too, so this is not just DNS. A Playwright walk of all 22
screens was written, run, and **deleted** — it captured 22 screenshots of the
login form, and its assertion (`report.length === SCREENS.length`) passed
anyway, which is the check-that-cannot-fail shape. When the network returns:
walk the panel and LOOK at it.

### The other four panels have the identical defects

While scoping the loading guard it failed on 20+ hand-rolled spinner blocks in
`gurukul-admin`, `gurukul-parent`, `gurukul-principal`, `gurukul-teacher`. The
guard in `emptyStates.test.ts` is deliberately scoped to `src/gurukul/` — a
guard that fails the build on work nobody has done yet is not a guard. Widen it
when those panels get the same pass.

---

## 12. STUDENT PANEL DESIGN — 2026-09-12 session

Six commits. Everything below was measured in a running browser, not read
off the source.

| commit | what |
|---|---|
| `ccc00fb` | skeletons for 19 screens; the page title stops waiting for the network |
| `33f4732` | "still resolving is not loaded" — the skeleton appeared AFTER the content |
| `d6ec600` | the 155-colour shadow palette, and text a student could not read |
| `090033b` | the word "null" in a student's test report |
| `2e826dd` | the whole panel, desktop + mobile, checked as a set |

### The two-halves split is closed

`components/ui-bits` exported a THIRD `PageHeader` — same props, different
design (`text-[28px]`, a bottom rule, a primary eyebrow) — and six
student-reachable screens imported it while nineteen imported the gurukul one.
That single import was the split. All six now use the panel's own header.

### What is now guarded, and where

| guard | what it would catch |
|---|---|
| `e2e/diag-panel-review.spec.ts` | 26 screens x 2 viewports: one h1 each, no sideways scroll, no `null`/`undefined`/`NaN` on screen, no blank screen |
| `e2e/diag-loading-states.spec.ts` | the page title must be on screen AT THE SAME INSTANT as the skeleton |
| `e2e/diag-loading-flashback.spec.ts` | a loading state must never appear after content |
| `e2e/diag-contrast.spec.ts` | computed WCAG contrast below 3:1 on 14 screens |
| `src/gurukul/palette.test.ts` | the 15 shadow-palette hexes, and `${colour}NN` concatenation |
| `src/gurukul/components/emptyStates.test.ts` | a spinner returned as a screen's loading state, labelled or not |
| `src/lib/conceptReportFallback.test.ts` | a placeholder reaching student-facing copy |
| `src/gurukul/pages/notificationIcons.test.ts` | icon-map keys drifting from what the DB writes |

Every one of them carries a positive control. Three of them were WRONG on
their first run and the controls are why that was noticed rather than shipped:
the contrast probe reported legible buttons as unreadable (a CSS gradient
zeroes `background-color`), then went half-blind (bailing on any ancestor
gradient), then swallowed 31 real findings behind its own coverage assertion.

### Still open

* **`hero-panel` is a class with no CSS.** Used in `pages/student/Battleground.tsx`
  and `pages/teacher/BattleMonitor.tsx`; defined nowhere. Those "hero" cards
  were meant to look different from a plain Card and do not.
* **The other four panels** (`gurukul-admin`, `-parent`, `-principal`,
  `-teacher`) have every defect this session fixed: hand-rolled spinners, the
  shadow palette, the size-as-colour rules. The guards are scoped to
  `src/gurukul/` on purpose — widen them when those panels get the pass.
* **Practice shows its four quick-start modes twice** — once in QUICK START and
  again in the All Modes grid below. Left alone deliberately: shortcuts above a
  full catalogue is a defensible pattern and this is an IA call, not a defect.
* **The `[class*="…"]` remapping rules in theme.css are now mostly dead.** The
  hexes they were rewriting are gone from `src/gurukul`. Removing them is safe
  in principle and unverified in practice — do it with the contrast probe and
  the panel review running.
