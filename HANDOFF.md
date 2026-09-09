# Gurukul — session handoff

Written 2026-09-09, updated the same day after §4's UI landed. Read this top to
bottom before touching anything.

---

## 0. Where you are

| | |
|---|---|
| Worktree | `.claude/worktrees/gurukul-tier1-e2e-fixes-c0b3c3` |
| Branch | `claude/gurukul-tier1-e2e-fixes-c0b3c3` |
| Local HEAD | `006e606` + seven later commits — **NINE COMMITS NOT PUSHED** (see §1) |
| Last pushed | `9daf600` |
| Supabase project | `psqxykzqfvxgsvkmgurn` |

**Do not `cd` to the main checkout.** Work inside the worktree.

---

## 1. THE NETWORK IS HALF DOWN — read this before you diagnose anything

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
3. **Replace legacy files, do not patch them.** If a file is causing the
   problem: analyse it fully (what it is, every place it connects), delete it,
   rewrite it properly, then re-check every connection point still works.
   `testService.ts` was done exactly this way — use it as the worked example.
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
verify:caller-privileges .. 412 assertions   PASS   (probe41 new, 11 claims)
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

### 5.5 THE DEPLOY DECISION — do not take it without the user

Nothing in §5's generation half works until `ai-gateway` is deployed, and
deploying it is not a neutral act:

* **`ai-gateway` drifts from the repo in 11 files**, measured 2026-09-09 with
  `npm run check:edge-drift`: `index.ts`, `aiRouter.ts`, `capabilityCatalog.ts`,
  `embeddingWorker.ts`, `imageDoubtSolve.ts`, `modelRouter.ts`,
  `parentNarrative.ts`, `promptLibrary.ts`, `questionPaperMarkingScheme.ts`,
  `questionPaperOutline.ts`, `responseValidator.ts`. Two of those eleven
  (`aiRouter`, `capabilityCatalog`) are THIS session's work and are meant to go
  up. **The other nine are production changes that never came back to the
  repo, and a deploy overwrites every one of them.** Nobody has established
  what they are.
* The function's own endpoint is on `*.supabase.co`, which has no IPv4 route
  from this machine, so a deploy could not be tested afterwards. Uploading code
  nobody can then call is how a green deploy hides a broken function.
* `dpp-generate-questions` was the ONE function with clean drift, and it no
  longer is: its `index.ts` now imports `_shared/questionGenerator.ts`. That is
  the intended change, but it means the next dpp deploy carries it too.

The three new findings were accepted into `edge-drift-baseline.json` on
2026-09-09 — repo-ahead-of-production is the normal state for undeployed work,
and a gate left permanently red is a gate that stops being read. Re-run
`npm run check:edge-drift` before deciding; after a deploy the drift resolves
and the baseline needs lowering again.

**THE THREE `src/academic/ai/questionPaper*.ts` MODULES ARE STILL UNCALLED.**
`planQuestionPaper` is a deterministic chapter-weight allocator and could feed
the blueprint form's defaults; `buildQuestionPaperOutline` returns question
STEMS, not questions. Neither was wired, because the teacher now states the
blueprint directly and an auto-allocator that disagrees with what they typed is
a second home for the same fact.

### 5.4 §6 — Gates that cannot fail — **ALL THREE DONE, 2026-09-09**

* **typecheck.** `npx tsc --noEmit` compiles 0 files under `src/` (measured:
  the root tsconfig's `files` is `[]`). Both workflows ran the one-flag-away
  variant `-p tsconfig.app.json`, which compiles 489 files but **never
  compiled `tsconfig.node.json` — the project with `strict: true`**. Both now
  run `npm run typecheck` (`tsc -b --force`), and spec rule 23 names the trap.
* **`db:check-migrations` — rewritten, not patched.** It asked 27 hand-written
  marker questions against **414** migration files, and exited 0 whatever it
  found. It is now the set difference against `public.schema_migrations`, exits
  1 on any file not in the ledger, and exits 2 when it cannot run. Proven both
  ways: 414/414 clean, and a throwaway unapplied file made it exit 1 naming
  that file. Its first run exited **127** — `process.exit()` with a live handle
  aborts inside libuv on Windows — which is the same "gate reports the wrong
  code" defect one layer down; it sets `process.exitCode` now.
  The opposite direction (applied, no file here) stays `npm run preflight`'s,
  and is reported but never failed on, so one fact cannot redden two gates.
* **lint.** `npm run lint:baseline` is now a blocking CI gate. The seven
  assorted errors are fixed — 2 `prefer-const`, 1 `no-unused-expressions`,
  1 `no-empty-object-type` by code, and 3 by an `eslint-disable` carrying a
  checkable reason, because "fixing" them meant changing a Devanagari
  character class, a NUL-anchored ASCII range and a mojibake repair map, all
  of which would have been behaviour changes wearing a lint fix. **113 errors
  / 71 warnings**, all `no-explicit-any`, frozen in `lint-baseline.json`.

Still open, and unchanged: **`lint:stale-columns` parses SQL function bodies
only** (340 of them). It cannot see TypeScript, which is why it passed while
`testService.ts` sent six non-existent columns for weeks.

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
