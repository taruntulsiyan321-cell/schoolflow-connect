# Known issues

Things found while building something else and deliberately NOT fixed there.
Each entry says what was measured, how it was measured, and why it was left.

Started 2026-09-04, build session 1 (XP write / test-generate-questions / Resources).

---

## 1. `requireAnyRole` in edge functions can never admit anybody

**Severity: high — it makes every deployed function using `requireAnyRole`
unusable by everyone. Two confirmed so far: `dpp-generate-questions` and
`ai-ping`, the latter being the connectivity check for the whole AI path
(`npm run ai:ping`), which no admin or principal can pass.**

`dpp-generate-questions` gates on
`requireAnyRole(req, ["teacher","admin","principal"])`, which calls
`admin.rpc("has_role", { _user_id, _role })` through a **service-role** client.

`has_role` branches on `auth.uid()`:

```
WHEN _user_id = auth.uid() THEN  <active membership check>
ELSE EXISTS (SELECT 1 FROM memberships m
             WHERE m.account_id = _user_id AND m.role = _role
               AND m.status = 'active'
               AND m.school_id = public.get_my_school_id())
```

A service-role client carries no user JWT, so `auth.uid()` is NULL, the ELSE
branch is taken, and `get_my_school_id()` is NULL there — `m.school_id = NULL`
is never true. Measured, both directions, rolled back:

| scenario | result |
|---|---|
| `has_role(priya,'teacher')` **with** priya's JWT | `true` |
| `has_role(priya,'teacher')` **with no** JWT | `false` |
| `get_my_school_id()` with no JWT | `NULL` |
| `has_role(admin,'admin')` with no JWT | `false` |

Priya Sharma has an active `teacher` membership in the right school, so this is
not a data gap. Confirmed over real HTTP: a genuine teacher's JWT gets
`403 {"error":"Forbidden","error_code":"insufficient_role"}` from
`dpp-generate-questions`.

**STILL OPEN — the fix is written but needs a human decision.** Two routes:

**(a) Fix `has_role` (preferred, no redeploy, fixes every caller at once).**
Widen only the cross-account branch, and only for a caller that has no session
and is `service_role`:

```sql
AND ( m.school_id = public.get_my_school_id()
      OR (auth.uid() IS NULL
          AND current_setting('role', true) = 'service_role') )
```

This is a no-op for every real user, and that is measurable rather than
asserted. Inside a SECURITY DEFINER function the obvious markers are useless —
measured:

| caller | `current_user` | `session_user` | `current_setting('role')` |
|---|---|---|---|
| authenticated | postgres | postgres | authenticated |
| anon | postgres | postgres | anon |
| service_role | postgres | postgres | service_role |

`current_user` is the *definer* for all three, so testing it would admit `anon`.
`current_setting('role')` is the one that survives, because PostgREST issues
`SET LOCAL ROLE`. For `authenticated` and `anon` the added disjunct is
literally false. `service_role` gains nothing it lacked — it already bypasses
RLS by role attribute; the change only stops a tenancy fence answering "no" to
a question it has no session to evaluate.

Writing that migration was **blocked by this environment's safety classifier**,
which is reasonable: `has_role` is referenced by hundreds of policies. It needs
an explicit go-ahead.

**(b) Fix `_shared/requireRole.ts` and redeploy.** Confirmed viable — the repo's
copy is byte-identical to the deployed one, so the local file really is the code
at fault. But a deploy would also ship the two drifted `_shared` modules in
issue 3, so that drift must be resolved first.

## 2. Students cannot reach question generation at all

`src/lib/aiPracticeQuestions.ts` is called from `Class12AiSession.tsx:121` (a
student route, `StudentDashboard.tsx:321`) and from `mistakeRecovery.ts:212`.
Its body and expected response match `dpp-generate-questions` exactly, so it now
points there — but that function's role gate is teacher/admin/principal, so
students are refused **by design** even once issue 1 is fixed.

**RULED 2026-09-04: students should reach it. BLOCKED, on issue 1 and on a
deploy.** Two reasons it cannot be done yet, neither of them the ruling:

1. Widening the gate to `["teacher","admin","principal","student"]` changes
   nothing while `has_role` answers `false` for every role from a service-role
   client. Issue 1 must land first or students swap a 403 for the same 403.
2. It requires redeploying `dpp-generate-questions`, and the two `_shared`
   modules in issue 3 have drifted, so a deploy from this repo does not
   reproduce production.

The recovered `supabase/functions/dpp-generate-questions/index.ts` was
deliberately NOT edited: its README states it is byte-for-byte deployed v12,
and editing it would quietly make that false. Change the role list at deploy
time, together with the drift resolution.

Worth deciding at the same time: the call charges the budget line
`teacher.dpp.generate_questions`. A student-triggered generation probably wants
its own feature_id so the two are separable in `ai_budget_usage`.

## 3. `dpp-generate-questions` is deployed but exists in no branch

Deployed version 12 (2026-08-20). Its source was deleted from the repo on
2026-08-30 in `7f9142b` when it was repurposed into `ai-recovery-variants`, ten
days *after* the deployed version was pushed. Production therefore runs code
that no worktree contains, and `supabase/config.toml:18-19` still declares
`[functions.dpp-generate-questions]` for a directory that is gone.

A `supabase functions deploy` from this repo would replace the live function
with something whose contract is completely different (service-role only,
`{source_question_id, tier}` in, writes `question_bank`). The two call sites
repointed in this session depend on the *deployed* contract.

Three other deployed slugs also have no local directory: `ai-expand-questions`,
`ai-ping`, `mcp`.

**PARTLY FIXED 2026-09-04.** The deployed version 12 of
`dpp-generate-questions` was pulled back byte-for-byte into
`supabase/functions/dpp-generate-questions/`, with a README recording its
provenance. Production now has a home in git.

Measured while doing it, and this is the part that still bites: **two of the
eight `_shared` modules it bundles have drifted** since version 12 was pushed —
`structuredCompletion.ts` and `promptLibrary.ts`. The other six, including
`requireRole.ts`, are byte-identical. So a deploy from this repo still would
not reproduce production, and that has to be resolved deliberately before
anyone redeploys.

`ai-ping` (deployed v10) was recovered too. `ai-expand-questions` and `mcp` are
still unrecovered.

**How to recover one, and the trap in doing it.** Use the MCP
`get_edge_function` tool and take `files[].content` — that is the pristine
source. Do **not** use the Management API
`GET /v1/projects/{ref}/functions/{slug}/body`: it returns an eszip whose
embedded sources are *transpiled*, with array literals re-wrapped, `*/ import`
joined onto one line and formatting normalised. Verified by trying it — a
byte-comparison against the real source fails on line 22 of a 60-line file for
formatting reasons alone. It is fine for asking "is this identifier present"
and useless for reproducing a file. A copy taken from it would look
authoritative and be subtly wrong. Extract programmatically; do not retype.

## 4. `npm run db:migrate` re-runs 356 migrations and cannot complete

The applier lists every file at or after `RECENT_SINCE` and runs all of them; it
never consults `public.schema_migrations` to skip what is already applied. It
therefore depends on all 356 being idempotent, and at least one is not:

```
FAILED: 20260509064250_0d3a48e5-93b0-4835-8c62-e3e252a5dbd6.sql
ERROR: 42710: policy "locks read auth" for table "attendance_locks" already exists
```

It exited 1 there, so no later migration was ever reached.

**FIXED 2026-09-04.** The applier now reads `public.schema_migrations` and runs
only what is genuinely pending. The ledger had been complete the whole time —
373 rows going back to 20260503, including the very file that failed. It was
written on every apply and never read.

    npm run db:migrate
    Ledger: 373 recorded, 356 skipped, 0 pending
    Nothing to apply.          (exit 0; it previously died on file 4 of 356)

`--replay` restores the old ignore-the-ledger behaviour if it is ever wanted. A
ledger that cannot be READ now aborts rather than replaying the folder blind —
"I could not tell what was applied" must not look like "nothing was applied" —
and that abort was tested with a deliberately invalid token. Its exit code is
now 1 rather than 127: `process.exit()` after a `fetch` trips a libuv assertion
and loses the code, so the script sets `process.exitCode` instead.

`node scripts/apply-one-migration.mjs <file>` remains the tool for applying
exactly one file (`--no-ledger` for fixtures and verification files).

## 5. `information_schema.role_table_grants` hides grants — do not audit with it

Querying it for `student_xp` returned **zero rows** while
`pg_class.relacl` held `authenticated=arwdDxtm/postgres` — full
INSERT/UPDATE/DELETE. The view only shows grants the querying role is a member
of. A privilege audit run through `information_schema` would have called
`student_xp` clean while the browser could write it.

Use `pg_class.relacl`, or `has_table_privilege(role, table, priv)`.

## 6. `learning_resources` read is school-wide, not class-scoped

`resources_select` is `same_school(school_id) AND (is_published OR admin OR
teacher)` — there is no class predicate. Measured in `probe9`: a student of 12-A
**can** read a resource targeted at 10-A when querying the table directly.

The class scoping users actually experience is applied one layer up, in
`ResourceService.listForStudent`'s
`or(class_id.eq.<mine>, class_id.is.null)` filter — also measured in `probe9`
and in the end-to-end run, where the 12-A student did not see the 10-A resource.

§10.11 states no read rule at all — it constrains who uploads, not who reads.

**RULED AND FIXED 2026-09-04** (`20260905020000`): "targeted at a specific
class" now binds the read too. A published resource reaches a student of the
target class, a parent of a child in that class (`is_class_of_my_child`), and
anything with `class_id IS NULL` (school-wide). Staff see everything in their
school. Principal was ADDED to the staff branch — previously they saw published
rows only through the `is_published` disjunct that this rewrite removes, so
without it they would have seen nothing.

probe9 now measures `OK: 0` for the 12-A student where it measured `OK: 1`
before, paired with two controls so a policy that merely hid everything could
not pass: the school-wide row still reaches that student, and the parent still
reads the class row.

## 7. `academic-files` is a public bucket with no tenancy scoping

Uploaded resources land in `academic-files`, which the student library already
resolves through `publicAcademicFileUrl` — that pairing predates this session
and decided the bucket.

The bucket is `public = true`, its object path is `{auth.uid}/{ts}-{name}` with
no school segment, and its SELECT policy is bare `bucket_id = 'academic-files'`.
So any authenticated user of any school can list every object, and anyone at all
with the URL can download one without a session. `storage.objects` has no
RESTRICTIVE tenancy fence, unlike the `public` schema tables.

**RULED 2026-09-04 — fix written, BLOCKED by this environment's safety
classifier** (it rewrites `storage.objects` policies). Needs an explicit
go-ahead, exactly like issue 1.

This is the cheapest moment the change will ever have, because nothing depends
on the public URLs yet. Measured: `learning_resources` 0 rows, `homework` with
attachments 0 rows, `homework_submissions` with attachments 0 rows, objects in
the bucket 1.

The migration, ready to apply:

```sql
UPDATE storage.buckets SET public = false WHERE id = 'academic-files';

DROP POLICY IF EXISTS "academic files read" ON storage.objects;
CREATE POLICY "academic files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id::text = (storage.foldername(name))[1]
         AND p.school_id = public.get_my_school_id()
    )
  );
```

Object keys are `{auth.uid}/{ts}-{name}` — user first, no school segment — so
the fence goes through the uploader's profile rather than a path prefix.
INSERT/UPDATE/DELETE already pin segment 1 to `auth.uid()` and stay untouched.

**The client work it needs**, which is NOT done and must land in the same
change or downloads break:

- `publicAcademicFileUrl` becomes async and returns a signed URL, handling
  three inputs: a bucket path, a legacy full public URL of this bucket (extract
  the path, then sign), and an external http(s) link (passthrough). The chat
  module already has this exact shape in `extractChatStoragePath`.
- Its two callers become async: `src/gurukul/pages/Resources.tsx:22` and
  `src/gurukul-teacher/Resources.tsx:350`.
- `uploadAcademicFile` returns a durable bucket path in `url` rather than a
  public URL, matching `toDurableChatAttachmentRef`.
- `AttachmentUI.AttachmentList` renders `a.url` straight into `<a href>` and
  `<img src>` (6 call sites), so it must resolve signed URLs into state, with
  the raw value as the fallback while loading.

## 8. A deleted class strands its resources permanently

`learning_resources.class_id` is nullable and its FK is `ON DELETE SET NULL`,
but every write policy required `class_id IS NOT NULL`. Deleting a class
therefore left its resources editable and deletable by nobody — not even the
uploader.

**FIXED 2026-09-04** (`20260905020000`). §10.11 says "Deletable by the
uploader" and attaches no class condition, so the old delete policy was
over-restrictive against the spec as well as stranding orphans. Delete now keys
on `created_by = auth.uid()` alone. Update still tests the teaching
relationship for the row's current class and still refuses to leave one
untargeted, but an orphan can be repaired. Update was additionally narrowed to
the uploader, matching the delete rule; nothing calls update today.

probe9 asserts the orphan case directly: class set to NULL, uploader deletes,
row gone.

## 9. `ownership.ts` disagreed with the database about who owns resources

`owners: ["admin", "principal", "teacher"]` against §10.11's "Uploaded by
teachers only — not admin, not principal" and against the live policies, which
require `has_role(auth.uid(),'teacher')` on all three write paths. probe4
already measured admin being refused.

**Fixed in this session** (narrowed to `["teacher"]`) because the new
`ResourceService.create`/`remove` guard through it and would otherwise have
promised a write the database refuses. Recorded here because it is the same
two-homes shape as the rest of this list.

---

## 7b. `doubt-images` is public and unsized — fold into the §7 approval

**Status:** SQL written, NOT applied. Needs the same approval as §7; the
environment refuses migrations that rewrite `storage.objects` policies.

`§7` named `academic-files`. It is not the only public bucket. Measured
2026-09-05 from `storage.buckets`:

| bucket | public | size limit |
|---|---|---|
| `academic-files` | **PUBLIC** | 20 MB |
| `doubt-images` | **PUBLIC** | **none** |
| `chat-attachments` | private | 10 MB |
| `doubt-attachments` | private | 20 MB |

`doubt-images` holds student-uploaded photographs of homework and handwriting —
faces, names, and a child's own work. Public on a Supabase bucket means
URL-enumerable: no token, no signature, no expiry. It is also the only bucket in
the project with **no size limit at all**, so it is an unmetered upload target
as well as a disclosure surface.

It is the worse of the two configurations and was not in the original §7.

### The SQL, preserved verbatim

Apply with §7's, so one approval covers both buckets.

```sql
-- doubt-images joins doubt-attachments: private, 20 MB.
UPDATE storage.buckets
   SET public = false,
       file_size_limit = 20971520
 WHERE id = 'doubt-images';

-- Read is via signed URL only; no anon SELECT policy is created. The owner
-- check matches doubt-attachments so the two behave identically.
DROP POLICY IF EXISTS "doubt images public read" ON storage.objects;

CREATE POLICY "doubt images owner read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'doubt-images' AND owner = auth.uid());

-- Verification: both buckets private, both sized, and no anon read survives.
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets
              WHERE id IN ('doubt-images','academic-files') AND public) THEN
    RAISE EXCEPTION 'ABORT: a bucket is still public';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets
              WHERE id IN ('doubt-images','academic-files') AND file_size_limit IS NULL) THEN
    RAISE EXCEPTION 'ABORT: a bucket still has no size limit';
  END IF;
END $verify$;
```

### It is not done when the migration applies

Making the bucket private breaks every existing `<bucket>/<path>` URL in the
client. The same signed-URL work §7 needs applies here, across the **6
`AttachmentList` call sites** — each must call `createSignedUrl` with a TTL
instead of `getPublicUrl`. `src/academic/storage/chatFileUpload.ts` already does
this for `chat-attachments` and is the pattern to copy.

Applying the SQL without that client change turns every doubt image into a
broken image. Sequence it: client first behind a flag, or both in one release.

---

## 8. Two deployed edge functions nothing calls

**Status:** Recorded, not acted on.

`send-otp` and `verify-otp` are deployed and ACTIVE. Neither is referenced
anywhere in `src` — the wired OTP path is `verify-msg91-widget`
(`src/lib/msg91Auth.ts:32`). Both predate the MSG91 widget integration.

They are `verify_jwt = false`, which is correct for an OTP endpoint and also
means they are reachable unauthenticated by anyone who knows the URL. Two live,
unauthenticated, uncalled endpoints.

Not deleted, because deleting a deployed function is irreversible from this repo
— neither has source that has ever been verified against production beyond the
provenance snapshot. Decide deliberately: retire both, or keep one as the
documented fallback and say so.

Note for provisioning a real project: they are in the 17 that would need
recreating, and probably should not be.

---

## 9. Two shared modules drift across 7 AI functions each — found 2026-09-06, not fixed

`_shared/modelRouter.ts` (repo `2cd4c73acfbd` / prod `2273dd3d509c`, 426 vs 278
lines) and `_shared/reasoningBudget.ts` (repo `fb5369f99b16` / prod
`3e2d4c35d6e6`) differ from the repo in **7 deployed functions each**:
`ai-academic-coach-agent`, `ai-concept-report`, `ai-explain`,
`ai-learning-pattern-agent`, `ai-ping`, `ai-recovery-agent`, `ai-revision-agent`.

Invisible until `check:edge-drift` began comparing each function's own `_shared`
snapshot: the merged tree let `dpp-generate-questions`, whose copies match the
repo, overwrite the copies that do not. `reasoningBudget.ts` had never been
reported as drifted at all.

Out of frozen scope (every AI function except `dpp-generate-questions`).
Recorded, accepted in the baseline as "known", **not reviewed and not fixed**.
Consequence to be aware of: prod's `modelRouter` there predates the
Nemotron/Qwen split, so cost attribution for those seven differs again from both
the repo and from `dpp-generate-questions`.

## 10. Three academic event types are unreachable aliases — found 2026-09-06, not fixed

`homework.assigned`, `homework.submission.created` and
`homework.submission.graded` are declared in `src/academic/events.ts` and are
emitted by nothing. The live triggers `trg_emit_homework_event` and
`trg_emit_homework_submission_event` emit `homework.published`,
`homework.submitted` and `homework.graded` instead — and `EVENT_SYNC_TARGETS`
maps each alias to **exactly the same** fan-out as the name actually emitted.

So they are duplicate vocabulary, not a missing emitter. Adding a service-layer
emitter for them would emit a second event per action and double every homework
notification, analytics row and audit entry. The SQL consumers already accept
both spellings (`20260731090000:434,439,469`).

Left in place rather than removed, because removing a name from the catalog is a
ruling. Recorded so the next session does not read the gap as work.

## 11. `QuestionBankService.insert` sends a `school_id` that does not exist — found 2026-09-06

**Severity: high if confirmed — it would mean no teacher can save a question to
the bank through the app at all**, by either route.

`src/academic/services/questionBankService.ts:78` builds every insert payload
with `school_id: r.school_id ?? ctx.schoolId`. **`public.question_bank` has no
`school_id` column.** Measured twice: the full `information_schema.columns` list
for the table (30 columns, no `school_id`), and a targeted count returning 0.
That is by design — §10.9 makes the bank "centralised and shared across all
schools", and `match_question_bank`'s own body says so.

Both teacher write paths go through that method:
`QuestionBankPage.saveDrafts` (the "Save to bank" button) and `importCsv`.

**What is NOT measured: the resulting error.** PostgREST rejects an unknown
column with `PGRST204` before reaching the database, which would make both
buttons fail every time — but that was not observed end to end. Reproducing it
needs a request as a real teacher, and the one attempt from here (an anon-key
insert against production) was refused by this environment's safety classifier,
correctly. **Confirm it with a teacher session before acting on it**; the column
facts above are solid, the consequence is inference.

Not fixed here: the fence in `20260906030000` was the scoped work, and removing
the key is a one-line change that should be made by whoever can watch the button
work afterwards.

## 12. Contributed questions are student-visible immediately — `is_approved` defaults to `true`

**This is a ruling request, not a defect report.**

The ownership ruling for the question bank states that contributed questions are
central on entry and that "`is_approved = false` is the scoping mechanism and
already exists", giving "visible to others only after approval".

The column exists. The mechanism does not. Measured 2026-09-06:

- `public.question_bank.is_approved` has **`DEFAULT true`**.
- `QuestionBankService.insert` sets it explicitly anyway:
  `is_approved: r.is_approved ?? true`.
- All 21,696 rows are `is_approved = true`; zero are false.

So a teacher's contribution becomes readable by **students at every school** the
moment it is saved (via `qb_select_approved_board`, subject to board match). The
author fence in `20260906030000` governs who may EDIT a row; it does not and
cannot govern who may SEE one.

Making entry `is_approved = false` is a two-line change, but it is not obviously
right and was deliberately not made:

- Staff read via `qb_staff_read`, which ignores `is_approved`, so the author and
  colleagues would still see their own contributions. Only students would lose
  them. That part is clean.
- **There is no approval mechanism anywhere** — no UI, no RPC, no role that
  approves. Flipping the default would mean contributed questions never reach a
  student at all, which is a different failure from the one it fixes.

Decide: (a) leave entry approved and accept cross-school visibility on save,
(b) default to false and build an approval surface, or (c) default to false and
accept that contributions are staff-only until one exists.

## 13. `match_question_bank`'s body cites §4.2a for a rule that lives in §10.9

Cosmetic, and recorded only because the same misattribution has now reached two
session prompts and the database.

The function comment reads "question_bank has no school_id and is shared across
schools by design (§4.2a)". The substance is right; the citation is not. §4.2a
is `docs/recovery-revision-analysis-spec.md:193` ("Generating the variants"),
part of the frozen recovery feature, and its "shared bank" means shared across
STUDENTS and over time. The clause that says "Centralised and shared across all
schools and all users" is **§10.9**, `docs/locked-decisions.md:385`. The phrase
"across schools" appears nowhere in the §4.2a document.

Corrected in `docs/gurukul-spec-rules.md`'s clause table. Not corrected in the
database, because that is a migration to change a comment.

## 14. `dpp-generate-questions` reserves AI budget it never releases on failure

`ai_budget_check_and_reserve` is called with `p_units: 2` **before** the
generation is attempted, and there is no compensating release on any failure
path. A run that reserves and then fails — provider down, bad JSON, truncation,
an exception — still consumes the school's daily units. Repeated failures burn a
school's whole allowance without producing a single question.

There is no `ai_budget_release`-shaped function to call, so fixing it means
adding one. Left alone deliberately: it predates this session's changes, it
affects the frozen AI functions equally, and inventing a budget-release path is
a design decision rather than a bug fix.

Noted while adding the same reservation to `embed` (1 unit,
`staff.embed.query`), which has the identical shape and the same caveat.

## 15. No approval queue — contributions are author-only until one exists

**Required before the bank is meant to grow cross-school. Recorded 2026-09-07.**

`20260907000000` made `is_approved` default false and widened
`match_question_bank` to `is_approved OR created_by = auth.uid()`. That closed a
measured leak — before it, another teacher, a student, and **a student at a
different school** all retrieved a teacher's contribution the instant it saved.

The consequence, accepted deliberately: **a contributed question is usable by
its author and by nobody else, permanently**, because nothing can approve it.
There is no UI, no RPC, and no role that sets `is_approved = true`.

That is the right trade for v1 — a paper builder that can use your own
questions is useful; a bank that broadcasts unreviewed questions to every school
in the country is not. But it means the write-back does **not** grow a shared
bank yet. It grows 21,696 shared reference questions plus one private pile per
teacher.

What an approval path needs, when it is wanted: a reviewer role (principal? a
subject lead? the spec does not say), a queue of `is_approved = false` rows
scoped to something a reviewer can actually see, and a decision about whether
approval is per-school or central. §10.9 says the bank is central, which implies
central approval, which implies a role that does not exist yet. **That is a
ruling, not a build task.**

## 16. `test_questions` cannot carry a written answer — decide before pushing a paper online

**Found while designing the paper output, 2026-09-07. Not fixed.**

The ruling for the question paper says the answer key is the marking source: if
a paper is pushed as an online test, the key drives the marking. The Tests
feature stores questions in `public.test_questions`, whose columns are:

    id, test_id, school_id, order_index, question, options jsonb,
    correct jsonb, marks numeric DEFAULT 1, explanation, chapter_id,
    chapter, concept, created_at

There is **no `question_format` column and no `answer` column.** `correct` is
`jsonb`, so a written answer *can* be stored in it, but nothing in the schema
distinguishes "index 2 of these options" from "a paragraph the teacher marks by
hand", and `rpc_test_questions_for_attempt` — the only path a student receives
questions through — was built for the MCQ shape.

So a paper with short/long sections has three possible routes and they are not
interchangeable:

- **(a)** Only MCQ sections are pushable online; written sections are
  print-only. Cheapest, and honest.
- **(b)** Add `question_format` and `answer` to `test_questions` and teach the
  attempt path to render and hand-mark them. Real work in a frozen-adjacent
  feature.
- **(c)** Store the written answer in `correct` and let the marking surface
  interpret it. Fastest, and exactly the two-homes shape (G9) this codebase
  keeps finding — the same column meaning two different things depending on a
  format that is not recorded.

`marks numeric DEFAULT 1` already exists per question, so the per-question marks
override maps cleanly whichever route is chosen. Only the answer does not.

**Not decided here.** The paper's own tables
(`question_paper_questions.answer`) hold the written answer correctly; this is
purely about the hand-off to Tests, which nothing does yet.

## 17. `super_admin` on `/admin` — RULING REQUEST, not a data problem

**Found 2026-09-08. Cause established; the fix is blocked on a decision, and a
change was written, tested and REVERTED rather than overturn a ruling.**

The `/admin` index renders an error banner for `super_admin` while its
sub-pages render fine.

**It is not the memberships-resolution problem it looks like.** That hypothesis
is measurable and it is wrong:

- `memberships` carries `CHECK (role <> 'super_admin')` — the role is
  structurally forbidden there **by design**, and nothing tries to read it there.
- The role still resolves correctly: `get_auth_context()` calls
  `effective_role()`, which has an explicit
  `WHEN _user_id = auth.uid() AND is_super_admin() THEN 'super_admin'` branch.
  `loadAuthContext` takes it through `role ?? row.role`.
- The school resolves too: `profiles.school_id` is set on
  `superadmin@wisdomcampus.com` (`00000000-0000-4000-8000-000000000001`).

**The actual cause is the service-layer capability matrix.**
`asOwnerRole()` in `src/academic/services/context.ts` returns `null` for
`super_admin` — "Never map super_admin into school portal ownership (not a
Gurukul actor role)" — so `assertCanConsume` throws `ForbiddenError` on every
read. The `/admin` **index** is the page that goes through that service layer
(`AttendanceService`, `AnalyticsService`, `LeaveService`); the sub-pages query
PostgREST directly, where RLS already admits super_admin through
`my_accessible_school_ids()`. That is exactly why one page fails and the rest do
not.

**Why this is a ruling and not a fix.** Two homes disagree (G9):

| says super_admin belongs in /admin | says it is not an actor |
|---|---|
| `auth/constants.ts:24` — `ROUTE_ALLOW["/admin"] = ["admin","super_admin"]` | `services/context.ts:48` — returns null, refuses every read |
| `auth/constants.ts:32,49` — every `ADMIN_PANEL_MODULE` granted | `services.test.ts` — asserts `assertCanConsume(super_admin,"marks")` **throws** |

A change mapping super_admin to admin **for reads only** (never writes) was
written and it worked — and it broke that existing test, which encodes the
opposite decision deliberately. It was reverted rather than edited away.
`rbac.ts:9` points the same way: `if (role === "super_admin") return "/admin"; //
future: platform console` — `/admin` is a **placeholder** for a console that
does not exist.

**Decide one of:**

- **(a)** super_admin reads school data as an admin does (writes still refused).
  Two lines in `context.ts`; the existing test must then be updated
  deliberately, because it is the ruling being overturned.
- **(b)** super_admin is not a school actor at all — then stop routing it to
  `/admin` and build the platform console `rbac.ts` already anticipates. The
  banner is then correct behaviour on a page it should never have reached.

Related and separate: `my_accessible_school_ids()` gives this account school A
through `profiles.school_id`, not through the audited, expiring
`super_admin_access_log` (0 live grants). If (a) is chosen, whether a platform
role should reach a school without an access grant is its own question.

## 18. PR #6 is not on the live branch — `e2e-evidence/` and the demo accounts

**Checked 2026-09-08.** The interaction run depends on this harness.

- `e2e-evidence/` exists on `origin/cursor/test-auth-e2e-suite-193d` and
  `origin/cursor/test-auth-e2e-suite-v2-193d` **only**. It is on no local
  branch and not on `claude/gurukul-s10-cold-start-96242c`.
- `docs/GURUKUL-V1.md` — named as the canonical v1 description and the first
  thing to read — **exists on no branch at all**, local or remote. Searched
  every ref. This session worked from the prompt plus `docs/locked-decisions.md`
  and `docs/gurukul-spec-rules.md` instead.

The two seeded demo accounts DO exist in the database and are usable:

| account | shape |
|---|---|
| `dual.role@wisdomcampus.com` | `d1000005-0002-…`, teacher:active **and** parent:active, one school |
| `superadmin@wisdomcampus.com` | `d1000005-0001-…`, **no memberships**, one live `super_admins` row |

So the accounts landed but the harness did not. Whether they sit inside
`strip-demo-tenants.mjs`'s UUID coverage was NOT verified — both use the
`d1000005-…` prefix rather than the two demo-tenant UUIDs that script keys on,
which is worth confirming before provisioning relies on it.

## 19. `MarksService.removeExam` has no UI caller — an exam is uncreatable-then-undeletable

**Found 2026-09-06 while making exam creation work again. Tier 2, not fixed.**

`removeExam` exists in `src/academic/services/marksService.ts:308` and
`deleteExam` in `examRepository.ts:142`. `grep -rn "removeExam" src/ --include=*.tsx`
returns **nothing**: no button, no menu item, on any panel — teacher, admin or
principal. The teacher exam card offers `<subject> marks`, `Review / publish`,
and nothing else; the admin Examinations screen is a read-only monitor
(`listExamSittingsForSchool` is its only service call).

So an exam created by mistake — a typo in the name, the wrong class — is
permanent as far as the application is concerned. `exams_delete` already
permits the class teacher, so this is a missing control, not a missing
permission. The Tier 1 evidence suite deletes its own exams over REST for
exactly this reason, and says so where it does it.

Not fixed here: adding a delete control to the exam card is a product change
beyond making the Tier 1 write path work.

## 20. Navigating away while marks save bounces the teacher back

**Found 2026-09-06. Tier 3, not fixed. Cosmetic — the write always lands.**

`LiveClassPanels.saveMarks()` does its work in this order:

```
await MarksService.publishBatch(...)
showFlash("Marks saved")          // the teacher is told it is done
await reload()                    // ...then two more awaits
const refreshed = await MarksService.getExam(ctx, exam.id)
setActiveSubject({ exam: refreshed, subject })   // re-mounts the marks sheet
```

The flash appears before the last three lines run, so a teacher who clicks
"Back to exams" in that window is silently returned to the marks sheet.
`finalizeSitting()` has the same shape: its `reload()` resolves after the
flash, so the exam list can serve a pre-finalise row and "Publish Results"
renders disabled even though `marks_locked` is already `true` in the database
(measured: it was true every time).

Nothing is lost either way — clicking again works. The fix is to move the
flash after the awaits, or to guard the trailing `setActiveSubject` on the
sheet still being open.

## 21. `students_read` has the same self-referential shape `exams_read` had

**Found 2026-09-06 while fixing `exams_read`. Not fixed: no Tier 1 path hits it.**

`students_read` is `id IN (SELECT my_visible_student_ids())`, and
`my_visible_student_ids()` selects `FROM public.students`. That is exactly the
shape that made `INSERT ... RETURNING` on `exams` fail 42501 — a STABLE
function cannot see the row its own statement is inserting.

It does not bite today only because `students` carries a SECOND permissive
policy, `students admin and principal all`, whose predicate is row-local
(`school_id IN my_accessible_school_ids() AND (has_role admin OR principal)`).
Permissive policies are OR-ed, so admin and principal are rescued by it.
Measured, as admin over real HTTP: `POST /students` with
`Prefer: return=representation` returns **201**.

The rescue is role-shaped, not universal. Any future insert into `students` by
a role outside that second policy — a teacher enrolling a student, a
self-registration path — would be refused 42501 with a message that names
row-level security while every visibility term is actually true. The same
`can_read_*_row` treatment applied to `exams` in 20260909000000 fixes it if
that day comes.

## 22. Both exam event emitters swallow their own failure

**Found 2026-09-06. Tier 3, not fixed.**

`MarksService.createClassExam`, `finalizeMarks` and `publishResults` all end
their emit with `.catch(() => undefined)`. A publish whose
`marks.results_published` event failed to write still returns the exam and
still tells the teacher "Results published to students & parents", while every
downstream fan-out keyed on that event — notifications, activity feed — simply
never happens, with nothing recorded anywhere.

This is why the Tier 1 evidence for exams asserts the event ROW in
`academic_events`, not just the success banner: the banner cannot distinguish
"published and announced" from "published and silent".

## 23. `/teacher/homework` and `/teacher/exams` are redirects, so tier1.spec never saw those panels

**Found 2026-09-06. Not a defect in the app; a defect in what the evidence proved.**

Both routes render `RedirectTeacherClassTab`, which writes a
`sessionStorage` hint and `<Navigate to="/teacher/classes" replace />`. The
homework and exam panels are tabs inside the class screen, mounted with a
`classId`, and are never at those URLs.

`tier1.spec.ts` navigates to `/teacher/homework` and `/teacher/exams` and
records what renders. What renders is the class list. Both surfaces were
recorded green — `rendered-empty`, no 4xx, no console error — for the whole
life of that spec, while the panels they name were never loaded and, as it
turned out, exam creation inside one of them was refused 42501 every time.

`tier1-writes.spec.ts` reaches the panels by opening the tab, which is why it
found what the URL probe could not.

## 24. Service class names are rendered to parents as UI labels

**Found 2026-09-06 while asserting the Tier 1 read surfaces. Tier 3, not fixed.**

Two internal identifiers are on screen in the Parent panel, in the place a
caption belongs:

| surface | on screen |
|---|---|
| `/parent/marks` | `EXAMINATION MARKS (MARKSSERVICE)` |
| `/parent` | `0` / `Pending Homework` / `HomeworkService` |

Captured from `document.body.innerText` as the signed-in parent, not from a
dev build. These read as debug breadcrumbs left from wiring each block to its
service, and a parent has no use for the name of a TypeScript class.

Not fixed here: it is cosmetic, it is outside the Tier 1 write paths this
change was scoped to, and renaming a visible label is the kind of thing worth
doing deliberately across the panel rather than in two spots.
