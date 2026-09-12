# Known issues

Things found while building something else and deliberately NOT fixed there.
Each entry says what was measured, how it was measured, and why it was left.

Started 2026-09-04, build session 1 (XP write / test-generate-questions / Resources).

---

## 1. ~~`requireAnyRole` in edge functions can never admit anybody~~ — FIXED

**FIXED 2026-09-07, and most of it was already done.** Route (b) was taken:
`_shared/requireRole.ts` asks `has_role` through the CALLER's client
(`requireUserJwt` already returns one) instead of the service-role client, so
the predicate resolves from the caller's own session. Route (a) — widening
`has_role` for session-less callers — stays rejected.

Measured in production, empty body on purpose so the role gate answers before
argument validation:

| function | as | before | after |
|---|---|---|---|
| `ai-ping` | admin | 403 insufficient_role | **200 `{"ok":true,"text":"pong"}`** |
| `dpp-generate-questions` | teacher | — | 400 (gate passed) |
| `embed` | teacher | — | 400 (gate passed) |
| `ai-gateway` | student | — | 400 (gate passed) |

Only `ai-ping` still needed deploying; the other three had already been
redeployed with the fixed helper. `npm run ai:ping` — the connectivity check
this entry says "no admin or principal can pass" — now passes.

A correction to how this was measured the first time: `ai-ping` gates on
`["admin","principal"]`, so testing it as a TEACHER returns 403 correctly and
proves nothing. The teacher result was briefly read as evidence of the defect.
The admin result is the one that means something.

Deploying `ai-ping` also reconciled its five drifted `_shared` modules;
`edge-drift-baseline.json` is lowered accordingly. `ai-gateway/index.ts` drift
remains and is accepted in the baseline — its actor gate is verified working in
production, and redeploying it would ship eight more drifted modules, which is
not this change.

The original finding follows.


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

## 2. ~~Students cannot reach question generation at all~~ — FIXED

**FIXED 2026-09-07 and verified in production. A student generated a question.**
Deployed `dpp-generate-questions` v15. Both blockers this entry named are gone —
issue 1 landed, and the `_shared` drift for this function was already resolved —
and a THIRD one it did not name was found and fixed in the same change.

**The blocker that was not in this entry.** `getCallerSchoolId` reads
`profiles.school_id` and nothing else, and that column is NULL on **40 of the 52
student accounts** (measured 2026-09-07). Widening the role gate alone would
have swapped `403 insufficient_role` for `403 No school context for caller` for
three students in four — the same feature still not working, with a new message.
A local `resolveSchoolId` now falls through `profiles.school_id` →
`students.school_id` → the active membership, which is the order
`useAcademicContext` already uses ("never invent a tenant"). Measured across all
52 student accounts: 12 resolve by profile, **40 by `students.school_id`**, 0 by
membership, **0 unresolvable**. It is deliberately local rather than in
`_shared/requireRole.ts`, which is snapshotted into all 18 deployed functions —
changing it there would report drift against every one of them for a fix only
this function needs.

**The budget question this entry raised is answered.** A student-triggered run
bills `student.dpp.generate_questions`; staff keep
`teacher.dpp.generate_questions` byte for byte, so existing per-feature quotas
and every `ai_budget_usage` row already written still mean what they meant. The
feature_id is chosen from the roles `requireAnyRole` matched, so a
teacher-who-is-also-a-parent bills as staff.

**Verified end to end** in `e2e-evidence/known-issues.spec.ts`, two browser
contexts because only an admin may read `ai_budget_usage`: the seeded student
POSTs to the function and gets **200 with a real generated MCQ** — not a 403,
not `insufficient_role`, not `No school context for caller` — and the
`student.dpp.generate_questions` usage row appears, charged 2 units. Live
afterwards: `student.dpp.generate_questions = 4` (two runs), while
`teacher.dpp.generate_questions` sat unchanged at 4.

A side effect worth recording: the README's "no live generation has ever been
run through this function from here" caveat is now partly answered.
`OPENROUTER_API_KEY` **is** present in the deployed environment — the MCQ above
came back from the provider. The non-MCQ (short/long) schemas remain unproven.

The original finding follows.

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

## 3. ~~`dpp-generate-questions` is deployed but exists in no branch~~ — FIXED

**FIXED 2026-09-07. Every deployed function now has a home in git.**
`npm run check:edge-drift` compares 18 deployed functions and reports **zero**
`NO-REPO-SOURCE` findings, where it reported two this morning.

- `dpp-generate-questions` — no longer merely recovered: v15 was DEPLOYED FROM
  this repo (KNOWN_ISSUES 2 and 14), so repo and production are the same source
  and the gate reports no finding of any kind for it. The `_shared` drift this
  entry said "has to be resolved deliberately before anyone redeploys" was
  resolved deliberately, in `035c99c`, before the deploy.
- `ai-expand-questions` (v6) — recovered with the MCP `get_edge_function` tool
  and written unedited. Its blanket NO-REPO-SOURCE is replaced by five specific
  `_shared` drifts, which is the point: the unknown became measurable. The
  drifted `requireRole.ts` predates the has_role fix, so this function is
  almost certainly refusing every caller. It has none, so nothing notices.
- `mcp` (v5) — recovered with `supabase functions download`, byte-identical to
  production and bundling no `_shared`, so it drifts nothing. It is
  auto-generated by `@lovable.dev/mcp-js`, a plugin that is in no dependency
  list and whose `src/lib/mcp/` source directory does not exist on any branch.
  **Its OAuth issuer names a different Supabase project** —
  `kdmjipeksjdyojjdokbi`, where this one is `psqxykzqfvxgsvkmgurn`. Recorded in
  `supabase/functions/mcp/README.md`; what that mismatch does at runtime is
  inference, not measurement, and is written up as such.
- `ai-ping` (v10) was already recovered on 2026-09-04.

Each carries a README with its provenance and the reason not to redeploy it
casually. Deleting any of them stays out of scope: it is irreversible from here.

The original finding follows.

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

## 4. ~~`npm run db:migrate` re-runs 356 migrations and cannot complete~~ — FIXED

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

## 6. ~~`learning_resources` read is school-wide, not class-scoped~~ — FIXED

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

**Re-measured live 2026-09-09**, because the 2026-09-08 audit reported this
entry as still open. It is not: the audit's classifier scanned for `RULED AND
DONE` and this body says `RULED AND FIXED`, so it read a closed entry as an
open one. The policy in the live database today is

```
resources_select USING (
  same_school(school_id) AND (
    admin OR principal OR teacher
    OR (is_published AND (class_id IS NULL
                          OR class_id = student_class_id(auth.uid())
                          OR is_class_of_my_child(class_id)))))
```

— the class predicate is in RLS, not only in `ResourceService`. Asked as the
caller, straight at the table, `npm run verify:caller-privileges` reports:

```
ok  10.11 RLS confines a resource to its class            student of 12-A  OK: 0
ok  10.11 school-wide resource still reaches every student student of 12-A  OK: 1
ok  10.11 resource visible to a student of that class      student of 10-A  OK: 1
ok  10.11 parent of a child in that class can read it      parent           OK: 1
ok  10.11 resource invisible across schools                student school B OK: 0
```

The refusal and its positive controls both hold, so the `0` is the fence and
not an empty table.

## 7. ~~`academic-files` is a public bucket with no tenancy scoping~~ — FIXED

**FIXED 2026-09-07. No bucket in the project is public any more.** With the
go-ahead given, `20260914000000` applied — the classifier did not refuse it this
time — and `20260914010000` corrected a defect in the SQL this entry had been
carrying.

```
academic-files    public=false  20 MB
doubt-images      public=false  20 MB    (was public, NO size limit — issue 7b)
chat-attachments  public=false  10 MB
doubt-attachments public=false  20 MB
```

**THE DRAFTED POLICY IN THIS ENTRY WAS BROKEN, and only a positive control
found it.** It read

    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id::text = (storage.foldername(name))[1]
               AND p.school_id = public.get_my_school_id())

Every denial test passed. The one that failed was "a Class 10-A student reads a
file uploaded by their own teacher". **A policy predicate runs as the CALLER**,
`public.profiles` has RLS, and a student sees exactly one row there — their own.
So the fence refused every academic file uploaded by anyone else, to everyone.
It would have read as a perfect security fix and silently broken every homework
attachment and every resource download.

A second defect sat in the same line: `profiles.school_id` is NULL on 44 of 64
accounts, so even with permission an object uploaded by most students would have
resolved to NULL and been readable by nobody, including its own uploader.

`storage_object_owner_school_id(text)` is SECURITY DEFINER and mirrors
`get_my_school_id`'s fallback chain (membership -> students -> teachers ->
parents -> profiles) for the OBJECT'S OWNER. The uploader is admitted by path
before any lookup, so a person always reaches their own file. An unresolvable
owner yields NULL, and `NULL = anything` excludes the row — no `IS NULL OR`
escape (G14).

**Verified** by probe28's 9 caller-privilege assertions (253 total) and, in the
browser, by `known-issues.spec.ts`: a teacher uploads, signs and fetches with no
Authorization header; **the old public URL no longer returns 200**; and a
student in the same school can sign the teacher's file — the assertion that
caught the defect.

The client half, landed earlier the same day, is what made this a one-line
migration rather than a migration plus a scramble. Its description follows.

This entry listed four pieces of client work and said they "must land in the
same change or downloads break". That was the wrong order, and doing it the
other way round is why the fence is now a one-line migration:

- `uploadAcademicFile` returns a **durable ref** (`academic-files/{uid}/{file}`)
  in `url` instead of a public URL, matching `toDurableChatAttachmentRef`. A
  public URL persisted into `homework.attachments` is a permanent bet that the
  bucket stays public; every such row breaks the moment the fence lands.
- `publicAcademicFileUrl` is replaced by **`academicFileUrl`**, async, returning
  a signed URL for our own objects and passing external links through
  untouched. It reads all three shapes that exist in live rows: a durable ref, a
  bare object path (`learning_resources.storage_path`), and a legacy public URL.
- Both `Resources.tsx` pages resolve hrefs **when the list arrives**, not on
  click. An await between the click and `window.open` is what a popup blocker
  cancels; the entry's "make them async" would have introduced exactly that.
- `AttachmentUI.AttachmentList` resolves each attachment to a signed URL in
  state, keyed by the stored ref rather than by index — this list is reordered
  by removal, and an index-keyed cache hands one attachment another's URL.
  Every render site the entry counted goes through this one component, student
  and teacher alike, so the six call sites were one fix.

**Why this works before AND after the fence.** `academic files read` is
`TO authenticated USING (bucket_id = 'academic-files')`, so signing succeeds for
every signed-in caller today. Once the fence narrows that predicate to the
uploader's school, signing starts failing for outsiders — which is the point —
and not one line of client code changes at that moment.

**Verified.** 12 unit tests in `src/academic/storage/academicFileRef.test.ts`
pin the ref/path parsing, including the two that would silently break things: a
legacy public URL must resolve to its path, and an external link (YouTube,
NCERT) must NOT, because signing it would replace a working link with a dead
one. The live half is in `e2e-evidence/known-issues.spec.ts`, as the seeded
teacher against the real bucket and the real policy: upload to
`{auth.uid}/{ts}-{name}`, sign, **fetch the signed URL with no Authorization
header at all** — the signature is the whole authority, which is what keeps it
working once the bucket is private — assert the body matches, delete, and assert
the object is gone.

A trap worth recording, because the first run passed on it: the sign API returns
a URL **relative to `/storage/v1`**. Fetching it unprefixed resolves against the
app's own origin and returns the SPA's `index.html` with status 200 — a green
assertion measuring nothing. supabase-js prefixes it; so does the test now.

**What is still needed** is only the migration below, unchanged. The measured
counts still hold: `learning_resources` 0 rows, homework attachments 0, objects
in the bucket 1. It remains the cheapest moment this change will ever have.

The original finding follows.

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

**The client work it needs** — DONE 2026-09-07, see the top of this entry. Left
below as written, because the list is accurate about what had to change even
though the sequencing advice ("must land in the same change") turned out to be
the wrong way round:

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

## 8. ~~A deleted class strands its resources permanently~~ — FIXED

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

## 9. ~~`ownership.ts` disagreed with the database about who owns resources~~ — FIXED

`owners: ["admin", "principal", "teacher"]` against §10.11's "Uploaded by
teachers only — not admin, not principal" and against the live policies, which
require `has_role(auth.uid(),'teacher')` on all three write paths. probe4
already measured admin being refused.

**Fixed in this session** (narrowed to `["teacher"]`) because the new
`ResourceService.create`/`remove` guard through it and would otherwise have
promised a write the database refuses. Recorded here because it is the same
two-homes shape as the rest of this list.

---

## 7b. ~~`doubt-images` is public and unsized — fold into the §7 approval~~ — FIXED

**FIXED 2026-09-07, in `20260914000000` alongside §7.** Private, and sized at
20 MB to match `doubt-attachments`.

**THE SQL PRESERVED BELOW WAS NOT APPLIED VERBATIM, and must not be.** Its read
policy was

    USING (bucket_id = 'doubt-images' AND owner = auth.uid())

which is owner-only — and the community doubt portal exists so that
**classmates and the subject teacher** can answer. `community_doubts` is
readable by exactly them plus school admin/principal. An owner-only image policy
makes every doubt picture invisible to everyone except the child who posted it:
a fence that silently removes the point of the feature while passing every
denial test.

The applied policy asks the ROW's own question instead — you may read the object
if you may read a doubt or an answer that references it — so the audience is
identical to the row's, no wider and no narrower. The match is exact (both
stored shapes enumerated), not `LIKE`.

**The client work this entry asked for landed in the same change.**
`doubtImageUpload.ts` stores a durable ref and `SignedDoubtImage` resolves it,
mirroring `chatFileUpload.ts`. There was nothing to migrate: measured
2026-09-07, `community_doubts` and `community_doubt_answers` held **zero**
non-null `image_url` and the bucket held **zero** objects. `getPublicUrl` now
appears nowhere in `src/`.

**Verified** by probe28: the asker reads their own picture, a **classmate**
reads it, the **subject teacher** reads it, a student in another class does not,
and a caller with no school does not.

The original finding, and the SQL as drafted, follow.

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

## 8b. ~~Two deployed edge functions nothing calls — make that four~~ — TWO DELETED

**RULED AND DONE 2026-09-07: delete the two unauthenticated ones, keep the two
that need a JWT.**

`send-otp` and `verify-otp` were `verify_jwt = false` — reachable by anyone who
knew the URL — and nothing called them; the wired OTP path is
`verify-msg91-widget` (`src/lib/msg91Auth.ts:32`). Both are **deleted from the
project**. `supabase functions list` now returns 16 functions, and **not one of
them is public**: there is no `verify_jwt = false` function left in this
project. Their `[functions.*]` entries went from `supabase/config.toml` with
them — a declaration for a function that does not exist is exactly how the
`ai-improvement-plan` entry noted in that file came to be stale.

**Their source stays in `supabase/functions/`.** That is what made the deletion
a reversible decision rather than a permanent one: `supabase functions deploy
send-otp` puts either of them back.

`ai-expand-questions` and `mcp` were KEPT. Both require a JWT, so neither is an
open endpoint, and `mcp`'s OAuth issuer names a different Supabase project — it
may belong to something outside this repo, and deleting it could break a
consumer not visible from here. They remain uncalled and documented, each with
a README recording exactly that.

The original two follow.

## 9b. ~~Two shared modules drift across 7 AI functions each~~ — RESOLVED, and the model was ruled

**FIXED 2026-09-07. The seven AI functions are deployed and clean.** The drift
baseline fell from **45 findings across 9 functions to 15 across 2**.

**What the drift actually was, measured rather than assumed.** Production was
not arbitrarily behind; the repo held three deliberate improvements that had
never shipped:

  1. `modelRouter.ts` — a free Nemotron primary with Qwen as a paid fallback.
  2. `structuredCompletion.ts` — real token counts and the model that actually
     answered, where production hardcoded `source: "openrouter_qwen"`. Every
     cost figure in this codebase was therefore an estimate.
  3. `promptLibrary.ts` — an anti-prompt-injection suffix on every system
     template, telling the model that content inside `<student_input>` /
     `<teacher_input>` tags and retrieval fields is data, not instructions.
     Production had none.

**RULED 2026-09-07: keep ONE model, Qwen 3.7 Flash.** The Nemotron primary is
removed. `modelRouter.ts` now has a single `MODEL` constant, and the two-stage
machinery is kept only because it is also the vision path and the retry path —
with one model configured, `hasDistinctFallback()` is false and the second stage
is skipped rather than re-calling the same model and paying twice for the same
refusal. `source` is `"openrouter_qwen"` in both unions, since there is one
model to name.

Verified after the redeploy: a seeded student generated a real MCQ through
`dpp-generate-questions` in **38.6s**, against 60–90s on the Nemotron primary.

**Deployed:** ai-explain, ai-concept-report, ai-battle-report,
ai-academic-coach-agent, ai-learning-pattern-agent, ai-recovery-agent,
ai-revision-agent, plus ai-ping and dpp-generate-questions (the latter was live
on Nemotron and had to come off it). Safe to widen: no consumer compares
`result.source` to a literal — all five callers pass it straight through to
their response, and no client code mentions either model name.

**Two functions deliberately NOT deployed, and both are the remaining 15
findings:**

- `ai-expand-questions` — no caller, and its README says a redeploy would
  replace five modules it has never run against as a side effect. Deploying it
  would gain nothing and contradict that note.
- `ai-gateway` — its `index.ts` is drifted too, not just its shared modules.
  Shipping an index change to the busiest AI function is a larger decision than
  a shared-module refresh and is not folded in here.

The original finding follows.

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

## 10. ~~Three academic event types are unreachable aliases~~ — ALREADY DONE

**Re-read 2026-09-07: this entry is STALE.** It says the aliases were "left in
place rather than removed"; they were removed from `src/academic/events.ts` on
2026-09-06, and that file's header records why. Confirmed against the live
database rather than the code: `academic_events` holds **0** rows of any of the
three types, ever, while the live triggers have produced
`homework.published`, `homework.submitted`, `homework.graded`,
`homework.updated`, `homework.archived`, `homework.deleted` and
`homework.submission.deleted`.

Note that `homework.submission.*` is not a dead namespace — `.deleted` is live.
Only `.created` and `.graded` under it were aliases.

Nothing to do. The original finding, which is still the clearest statement of
why wiring an emitter would have been wrong, follows.

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

## 11. ~~`QuestionBankService.insert` sends a `school_id` that does not exist — found 2026-09-06~~ — FIXED

**FIXED 2026-09-07, and it was worse than the entry said.** The `school_id` was
real and is gone, but removing it only exposed the next refusal. Measured as a
real teacher over HTTP, both shapes in one run:

```
WITH school_id     400  PGRST204  Could not find the 'school_id' column of 'question_bank'
WITHOUT school_id  400  23514     violates check constraint "question_bank_active_must_be_keyed"
```

So the inferred consequence — **no teacher could save a question to the bank by
either route** — was correct, and it survived the obvious one-line fix.

`question_bank_active_must_be_keyed` is
`CHECK (NOT is_active OR (chapter_id IS NOT NULL AND class_level IS NOT NULL))`
with `is_active` defaulting TRUE. **No write path had ever sent a `chapter_id`**
— `QuestionBankInsertRow` had no such field, and `saveDrafts` built rows with a
free-text `chapter` string. §10.22 says why that could never work: *"Chapter is
picked, never typed."* A typed name is not a `chapter_id`, and §10.10 keys
everything downstream — mistake book, custom sessions, analysis — on the id.

**What changed.** The meta bar is now Class → Subject → Chapter, each list read
from the curriculum tree and narrowed by the one before it
(`CurriculumService` / `curriculumRepository`, new). The picked chapter's id
goes on every row, its name into the legacy `chapter` text column, and the
subject is stored with the curriculum's own spelling so the text columns agree
with the id. `assertQuestionRowsAreKeyed` refuses an unkeyed row in the service
with a message naming the row and what to pick, so a 23514 never reaches a
teacher as "One of the values isn't valid."

Three things the old screen got wrong fell out with it: the hardcoded subject
list offered Computer Science, Social Studies and General Knowledge (no class
teaches them) and omitted Social Science and Environmental Studies (5,112 bank
questions use them); the class dropdown started at 6 while the tree starts at 5;
and "Any" class was unsavable by construction.

**Verified end to end** by `e2e-evidence/known-issues.spec.ts`, as the seeded
teacher through the browser: a CSV import saves, the row carries the picked
`chapter_id`, that id resolves to the chapter whose name was picked, and the
class matches — with a negative control asserting a chapterless insert is still
refused 23514, and both rows deleted and the deletion asserted.

**Two defects found while verifying, both fixed here:**

1. Switching class left the previous class's subjects on screen until the new
   list arrived, so a click could record a subject that was about to be replaced
   — measured: Biology clicked at Class 6, English saved. The lists are now
   emptied before each reload, which disables the control instead of offering
   stale options.
2. The negative-control probe originally omitted `created_by`, so the author
   fence refused it 42501 and the check constraint was never reached — a
   refusal that looked right and measured nothing.

**Not fixed, and NOT this entry's to decide — see issue 27.** The curriculum
tree seeds Class 5 and the bank refuses it.

The original finding follows.

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

## 12. ~~Contributed questions are student-visible immediately — `is_approved` defaults to `true`~~ — RESOLVED

**RULED AND APPLIED by `20260907000000`; the title above is now stale.** Measured
live 2026-09-07: `question_bank.is_approved` **defaults to `false`**, and
`buildQuestionBankInsertPayload` no longer forces it true — a test asserts the
key is absent from the payload so the column default is what decides.

**RESOLVED IN FULL 2026-09-07.** The consequence this entry predicted — with no
approval mechanism, a contribution reaches no student — was real and is now
gone: issue 15 built the queue, and a super admin can approve. The 21,696 seeded
questions were not touched and remain approved.

The original ruling request follows.

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

## 13. ~~`match_question_bank`'s body cites §4.2a for a rule that lives in §10.9~~ — FIXED

**FIXED — and it was already fixed when this entry was re-read on 2026-09-07.**
`20260907000000_question_bank_approval_default.sql` rewrote the function's
header in the same change that fixed the `is_approved` default. Verified against
the live database, not the file: `pg_get_functiondef` now reads "§10.9,
docs/locked-decisions.md:385. (This comment previously cited §4.2a, which is a
different clause in a different document and governs variant generation, not
cross-school sharing.)" No further migration is needed. The last paragraph
below — "Not corrected in the database" — is stale.

The original finding follows.

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

## 14. ~~`dpp-generate-questions` reserves AI budget it never releases on failure~~ — FIXED

**FIXED 2026-09-07 and verified in production.** `20260913000000` adds
`public.ai_budget_release`, the exact inverse of the reservation, and
`dpp-generate-questions` v15 calls it on every failure path after the units are
taken: an unusable `question_format`, a rejected `source_url`, a request with no
topic or source, a provider that returns nothing usable, and the catch-all.

The entry said fixing it "means adding one" and that inventing a budget-release
path is a design decision. It is, so the decisions are written down rather than
implied:

- **It never inserts.** A release for a school/day with no usage row is a
  release of something never reserved; creating the row would manufacture a
  negative balance out of a bug elsewhere. It reports `released: false` instead.
- **It never goes below zero.** `GREATEST(units_used - p_units, 0)`, so a double
  release — a retry, a duplicated failure path — cannot mint credit that lets a
  school exceed its hard limit.
- **It is service_role only**, exactly as `ai_budget_check_and_reserve` is. A
  function that lowers your own bill is not callable from a browser.
- **It takes the same advisory lock** as the reservation, so a release cannot
  interleave with a concurrent reservation's read-then-write.
- **Nothing is retro-credited.** There is no record of which past reservations
  failed, so any correction would be invented. From here forward only.

In the function, `RESERVED_UNITS` is one constant used at both ends — the
reserve and the release have to move together or a refund silently returns the
wrong amount. `refund()` is idempotent through a `held` flag so no path can
double-release, and it swallows its own failure on purpose: a release that fails
must not turn a 400 into a 500 and hide the real reason from the caller. It logs
instead.

**Verified, and deliberately not by the happy path.** The provider answered on
the first run, so the success branch charged 2 units — correct, but it never
exercised the refund. The test therefore makes a second call with
`question_format: "bogus"`, which is rejected AFTER the reservation and BEFORE
the provider: precisely the shape this entry described.

    400 {"error":"question_format must be mcq, short or long"}
    units_used before == units_used after

Live afterwards, two full suite runs later: `student.dpp.generate_questions = 4`
— the four units from the two runs that produced questions, and nothing from the
two that were rejected.

probe27 adds 11 caller-privilege assertions: a teacher is refused EXECUTE on
both the release and the reservation (with a control proving the probe's session
is genuinely authenticated, so the two denials cannot pass for the wrong
reason), reserve(3) then release(3) returns both the school and feature counters
to where they started, a double release clamps at zero, a release for a school
with no usage row inserts nothing, and zero units is rejected as `invalid_args`.

The `embed` function noted below has the same shape and still does not release;
it reserves 1 unit for `staff.embed.query`. Not changed here — it is a different
deploy, and this entry's scope was the function it names.

The original finding follows.

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

## 15. ~~No approval queue~~ — BUILT 2026-09-07, and the spec named the reviewer

**FIXED. It was not an open ruling either.** This entry asked "a reviewer role
(principal? a subject lead? the spec does not say)" and "whether approval is
per-school or central". §10.20 Super admin, "Can do", says: **"Manage the
central question bank."** §10.9 says the bank is "Centralised and shared across
all schools and all users." Central bank, central approval, a named role that
already exists. That is three entries in a row (17, 27, 15) where the ruling was
already written down.

**A hole this entry did not know about, closed in the same change.**
`qb_staff_update` is `created_by = auth.uid() AND (admin OR principal OR
teacher)` and did not exclude `is_approved`, so **a teacher could approve their
own question** and broadcast it to every school. Measured as the author
immediately before the migration:

    UPDATE question_bank SET is_approved = true WHERE id = <my own>   -> OK: 1

`is_approved`'s FALSE default was the entire protection added by
`20260907000000`, and the person it protected against could undo it with one
statement. A BEFORE UPDATE trigger now refuses any change to `is_approved` by
anyone who is not a super admin — a trigger and not a policy, because WITH CHECK
cannot see the OLD row and so cannot tell an UPDATE that CHANGES the column from
one that leaves it alone. A teacher still edits their own question's text;
probe30 asserts that as a positive control.

**And the reviewer could not see what they were reviewing.** Measured: a super
admin could read **56 of 21,696** rows. `qb_staff_read` is
`is_principal_or_admin OR teacher`, neither of which includes a super admin, so
the only policy admitting them was `qb_select_approved_board` — which needs
`is_approved` AND a board match against `get_my_school_id()`, deliberately NULL
for a super admin (§10.20). That left the `board = 'both'` rows: 56. The other
21,640 are `board = 'rbse'`. `qb_super_admin_read` fixes it.

**What was built** (`20260914030000`): `approved_by` / `approved_at` /
`review_note` for provenance, a partial index on the pending rows,
`rpc_question_bank_review_queue` and `rpc_review_question` (both super-admin
only, both resolving the author's NAME through the definer because a super
admin cannot read `profiles`), and a real screen at
`/admin/question-bank-review` whose nav item appears for a super admin and
nobody else.

Rejection is `is_approved = false` with a reason, **not a delete** — §10.21's
reasoning for reported questions applies unchanged: a question may already sit
in a student's mistake book.

The 21,696 seeded rows keep `approved_by` NULL. They were seeded, not reviewed,
and inventing a reviewer for them would be a lie in a provenance column.

**Verified** by probe30's 11 caller assertions and, in the browser, by a teacher
contributing a question and a super admin approving it on the real screen — with
the row's `approved_by` and `approved_at` read back afterwards.

The original finding follows.

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

## 16. ~~`test_questions` cannot carry a written answer~~ — DECIDED AND BUILT

**FIXED 2026-09-07. §10.24 makes the choice:** "The app can only analyse what it
holds as structured questions with answers", and its table gives auto-grading to
"MCQs in the app, with answer key" alone; everything else is "Completion only".
That is this entry's **option (a)** — written sections are print-only — which it
called "cheapest, and honest".

**The schema half of (b) was built anyway, and that is the point.** (a) alone
leaves the trap this entry named: a `correct jsonb` column that will happily
hold a paragraph, so the next person wiring the hand-off takes route (c) —
one column meaning "which option" or "prose a person marks", decided by a format
recorded nowhere (G9). `question_format` and `answer` now exist and
`test_questions_shape_matches_format` makes route (c) **structurally
impossible**. probe31 asserts both directions.

**The line is auto-markable versus hand-marked, not MCQ versus rest** — the
first version of this migration got that wrong and `20260914050000` corrected
it. `TestService.mapKindToDb` already emits four kinds, and `rpc_test_submit`
grades by `a.response = q.correct`, plain jsonb equality — which handles
`{value: 4}` as well as it handles an option index. So `numerical` is
auto-marked and stays online; only `short` and `long` are prose.

**The attempt path REFUSES rather than filters.** A paper containing a written
question raises, naming §10.24, instead of quietly serving a shorter paper —
a silently truncated paper is a wrong mark nobody can see. probe31 asserts the
refusal AND that an all-MCQ paper, and a numerical one, still serve.

Measured before: 576 rows, 0 with a NULL `options`, 0 with a NULL `correct`,
every `correct` a jsonb string. All 576 are MCQ, so the `'mcq'` default is right
for every one of them.

**Two things found while doing this and NOT folded in:** `TestService` sends a
`kind` column that does not exist, and writes `correct` in a shape the 576
existing rows disagree with. Logged as issue 28.

The original finding follows.

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

## 17. ~~`super_admin` on `/admin` — RULING REQUEST~~ — RULED BY THE SPEC

**FIXED 2026-09-07. It was not a ruling: §10.20 already decided it, and the
entry below did not consult it.**

> "**Unrestricted access to academic data, for support.** Every access is
> logged... **The access-log row is the grant.** Unlogged super admin access is
> not expressible in the schema — there is no path to data without a log entry."
> — §10.20, docs/locked-decisions.md:611-634

So option (a) — super_admin reads school data, writes still refused — is what
the spec says, with a condition the entry's two options both missed: the read
must arrive through a logged, expiring GRANT.

**And the grant was not the only path.** `get_my_school_id()` ends in a
`profiles.school_id` fallback, and the seeded super admin carries school A
there with 0 memberships, 0 grants and 0 access-log rows ever written. It
reached a tenant's academic data through a column on its own profile row. That
is precisely what §10.20 says is not expressible. **20260911000000** closes it;
`rpc_super_admin_open_access` (which already existed) is now the only way in.

Three more things had to be true before /admin actually rendered, each found by
re-running the test rather than by reasoning:

1. **20260911010000** — `same_school()` returned NULL rather than false for a
   caller with no school, and called `super_admin_has_access()` per row.
2. **20260911020000 / 20260911030000** — the activity-feed policies were built
   from per-row `same_school(school_id)` and bare `has_role()` calls, so
   `ORDER BY created_at DESC LIMIT 6` walked all 9,134 rows and returned
   `57014 canceling statement due to statement timeout`. That 500 — not a
   ForbiddenError — was what the banner had become. Rewritten to the set form
   (`school_id IN (SELECT my_accessible_school_ids())`) with the role test
   hoisted into a scalar subquery, the idiom 31 other fences already use.
3. **The service layer** — `assertCanConsume` no longer refuses super_admin,
   and eleven school-wide READ guards moved from `isSchoolOperator` to a new
   `canReadSchoolWide` (admin | principal | super_admin). `assertCanOwn` and
   every WRITE guard are untouched: support is a read.

`services.test.ts` asserted the opposite ruling and was updated deliberately,
with the reason in the test. probe22, probe23 and probe24 assert the behaviour
as the caller — 25 assertions, both directions, including that a super admin
with no grant reads nothing and one with a grant reads only the granted school.
`T4 super_admin · admin home` passes.

**Two adjacent contradictions fixed on the way**, both the same shape — a client
promising what the database refuses:

- `ownership.ts` listed `principal` among the owners of `attendance`; §10
  says "Cannot mark or edit attendance".
- `AuditReadService` gated on `isSchoolOperator` (admin OR principal); §10.18
  says the audit log is "Visible to admin only". Narrowed to admin. The one
  caller, `PrincipalClassDetail`, already wraps it in its own try/catch and
  degrades to zero, so nothing regressed.

The original finding follows, including its two proposed options.



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

## 18. ~~PR #6 is not on the live branch~~ — STALE

**RESOLVED 2026-09-07 by the merge this entry asked for.** `e2e-evidence/`
is on `claude/gurukul-tier1-e2e-fixes-c0b3c3` and has been the whole Tier 1
evidence surface this session: tier1.spec, tier1-writes.spec, tier1-reads.spec,
tier2-5 and the auth setup all run from it, 61 tests, 0 failing.

Both seeded accounts work: `superadmin@wisdomcampus.com` signs in and
`/admin` now renders for it (KNOWN_ISSUES 17), and
`dual.role@wisdomcampus.com` switches teacher -> parent through the UI.

STILL TRUE, and still unresolved: **`docs/GURUKUL-V1.md` exists on no branch**,
local or remote. Every session since has worked from `docs/locked-decisions.md`
and `docs/gurukul-spec-rules.md` instead. If that document exists anywhere, it
is outside this repository.

The original finding follows.

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

## 19. ~~`MarksService.removeExam` has no UI caller — an exam is uncreatable-then-undeletable~~ — FIXED

**FIXED 2026-09-07.** A Delete control now sits on the teacher's exam card
(`LiveClassPanels`), rendered for the class teacher — the same person §10.5
lets create the sitting — and calls `MarksService.removeExam`. The confirm
names the marks, because `deleteExam` removes them with the sitting. No
permission changed: `exams_delete` already admitted the class teacher, and
`assertTeacherMayManageAcademicWork` already guarded the service. Proven by
`examination.deleted` appearing in `academic_events` for the first time — the
REST fallback the suite used before could not have emitted it. The Tier 1 exam
test now cleans up through this button.

The original finding follows.

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

## 20. ~~Navigating away while marks save bounces the teacher back~~ — FIXED

**FIXED 2026-09-07.** `saveMarks()` still shows its flash before the trailing
`reload()` and `getExam()`, but the `setActiveSubject` after them is now
guarded by a ref mirroring the sheet the user is actually on. If they left, it
is not re-opened. State could not be read from the closure, which is why a ref
rather than the state value.

The original finding follows.


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

## 21. ~~`students_read` has the same self-referential shape `exams_read` had~~ — FIXED

**FIXED 2026-09-07 by 20260912010000 — and a claim made while fixing it was
wrong, so it is corrected here.** I first wrote that the self-reference also
made every roster read O(n²), "a scan of students per student row". It does
not: `id IN (SELECT my_visible_student_ids())` is a hashed SubPlan, so the
function runs once per statement. Measured as a teacher, before and after:
463/190/619 ms against 580/890/415 ms — indistinguishable. **There was no
performance defect here.** What is real is the latent 42501 this entry
originally described, and that is the only reason the change stands.

Replaced with `can_read_student_row(id, school_id, user_id, parent_user_id,
class_id)` — the same predicate term for term, asked about the row. probe26
asserts all eight claims as the caller: teacher, student, parent, admin,
another guardian's child refused, another school refused, and
`INSERT ... RETURNING` succeeding.

The original finding follows.


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

## 22. ~~Both exam event emitters swallow their own failure~~ — FIXED

**FIXED 2026-09-07.** All five `emitEvent(...).catch(() => undefined)` calls in
`marksService` now use `emitEventBestEffort`, which this same file already
used for `removeExam`. It still never fails the write — an event is not worth
losing a published result over — but it logs `[academic] emit <type> failed`
instead of discarding the reason.

The original finding follows.


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

## 24. ~~Service class names are rendered to parents as UI labels~~ — FIXED

**FIXED 2026-09-07.** Five user-facing labels stopped naming TypeScript classes:

| where | was | now |
|---|---|---|
| `/parent/marks` | `Examination marks (MarksService)` | `Examination marks` |
| `/parent` | `MarksService · TestService` | `Exams and tests` |
| `/parent` | Pending Homework sub `HomeworkService` | `not yet submitted` |
| `/admin/classes` | `Save via AttendanceService` | `Save attendance` |
| `/admin/classes` | `… · AnalyticsService.classRollups · AttendanceService` | `N live classes` |

Also the attendance panel's `Class ID · d2000001… · AttendanceService`, which
now states the rule the panel exists for: "Correcting a submitted day is
admin-only (§10.5)". No test asserted any of these strings, checked before
changing them.

The original finding follows.

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

## 25. ~~An admin can never correct submitted attendance — a stale audit trigger~~ — FIXED

**FIXED 2026-09-07 by 20260910000000, and the cause was not what this entry
assumed.** The fix was never missing: 20260904100000 (audit consolidation) had
already repointed `tg_log_attendance_change` at `academic_audit`, resolving
section and date from `attendance_submissions`. That migration APPLIED — 48
rows carry `metadata.migrated_from = 'attendance_audit'` and `audit_logs` is
gone — but the live function was chunk46's and `attendance_audit` still
existed, although the same migration ends with `DROP TABLE`.

One explanation covers both: `20260826200000_chunk46` CREATEs that table and
CREATE OR REPLACEs the old function, and `npm run db:migrate` replays every
file from the 20260509 cutoff (issue 4 below). **A replay after 2026-09-04
reinstated both on top of a consolidation that had already succeeded.**
Re-running the consolidation could not repair it either: its verification
asserts `academic_audit` holds exactly 8878 rows, and an audit table grows.

20260910000000 re-applies only what the replay undid, and asserts shape rather
than row counts so it cannot rot the same way. probe21 asserts the behaviour as
the caller: the teacher is refused with the §10.5 message and the mark is
untouched; the admin's correction succeeds, the mark changes, and the
`academic_audit` row lands carrying the frozen class_id, date and
submission_id. Re-verified over real HTTP as the admin, and restored after.

**The general hazard stands: a `db:migrate` replay can silently revert any
later migration.** That is issue 4, and this is the first time it has been
caught doing it.

The original finding follows.

**Found 2026-09-06. HIGH for the rule it breaks; not fixed here (Tier 2).**

§10.5 (docs/locked-decisions.md:203-205) says attendance is "submitted once.
After submission, only admin can edit." `rpc_bulk_upsert_attendance` implements
exactly that: it refuses a non-admin with "Attendance for this section on % has
already been submitted. Only an admin can change it.", and lets an admin
through to the UPDATE.

The UPDATE then always fails:

```
42703  record "new" has no field "class_id"
```

`attendance_audit_trg` (AFTER UPDATE) runs `tg_log_attendance_change`, whose
body is

```sql
INSERT INTO public.attendance_audit
  (attendance_id, student_id, class_id, date, prev_status, new_status, edited_by)
VALUES (NEW.id, NEW.student_id, NEW.class_id, NEW.date, ...)
```

`public.attendance` has neither `class_id` nor `date` any more — its columns are
`id, student_id, status, marked_by, created_at, school_id, submission_id`. Both
moved to `attendance_submissions` in the submissions refactor and the trigger
was never carried over. It fires only when the status actually changes
(`OLD.status IS DISTINCT FROM NEW.status`), which is precisely a correction, so
the failure lands on the one operation it exists to record.

Measured as the admin over real HTTP: `POST /rest/v1/rpc/rpc_bulk_upsert_attendance`
for a day already submitted returns
`{"code":"42703","message":"record \"new\" has no field \"class_id\""}`.

Consequences: a student marked absent by mistake stays absent forever, and the
`attendance_audit` table can never receive a row. The insert path is unaffected,
so first-time marking works and this stays invisible until someone tries to fix
a mistake.

Not fixed here: it is outside the Tier 1 list (which is marking and submitting,
both of which work), and the fix has a real decision in it — whether the audit
row should now carry the submission's class and date via a join, or whether
`attendance_audit` should be re-shaped to point at `submission_id` instead.

## 26. ~~No admin screen exists for the correction §10.5 reserves to admins~~

**WITHDRAWN 2026-09-07 — this finding was WRONG, and the error is worth
recording because of how it was made.**

The screen exists. `/admin/classes` renders every class with its own **Roster**
and **Attendance** buttons, and Attendance opens `AttendancePanel` in
`src/gurukul-admin/Classes.tsx`: a date picker, the roster, a
Unmarked/Present/Absent select per student, and Save, going through
`AttendanceService.markBulk` — the same service the teacher grid uses.

**How the wrong conclusion was reached.** The check was
`grep -rn attendance src/pages/admin src/gurukul-admin`, which DID list
`Classes.tsx`. The file was never opened. A grep that returns a hit is not
evidence of absence, and "no marking UI" was asserted from a file list rather
than from the file. The same session had already been bitten by asserting
behaviour it had not executed; this is that shape again, in prose instead of
in a test.

It is now covered by a test that would have caught the claim either way:
`Tier1-W · admin · correct a submitted day` drives /admin/classes → Attendance,
flips an already-marked student, saves, reloads to prove it stuck, and puts it
back. It asserts the student is ALREADY MARKED first, so the save under test is
an UPDATE — the path 25 had broken — rather than an insert that never failed.

One real defect did come out of re-checking this, and is fixed: `ownership.ts`
listed `principal` among the owners of `attendance`, and
`assertTeacherMayMarkClass` waved through every `isSchoolOperator`. §10
Principal panel says "Cannot mark or edit attendance" and, in the same breath,
"No screen offers the principal an action they lack permission for". The
database always agreed — `rpc_bulk_upsert_attendance` raises "The principal
cannot mark attendance" — so the client was promising something the server
refuses. Both now say admin.

## 27. ~~The curriculum seeds Class 5; the question bank refuses it — RULING REQUEST~~ — RULED BY THE SPEC

**FIXED 2026-09-07. It was not a ruling request: §10.9 had already decided it**,
the same way §10.20 had already decided issue 17.

> "Filtering by tag is what keeps content appropriate — **a Class 5 student is
> only ever served Class 5 content for their own board.**"
> — §10.9, `docs/locked-decisions.md:391`

The spec names Class 5 by hand, as the worked example of the whole tagging rule.
The curriculum tree agrees: Class 5, 4 subjects, 55 chapters, seeded. Nothing
was open.

**Where the 6..12 came from.** `20260821120000` archived all 2,189 Class 5
questions on these stated grounds:

> "outside the app's ClassLevel domain (6..12, ... resolveCurriculumScope only
> ever queries 6-12), so these 2204 rows are silently unreachable by any
> student/teacher query. Archive (is_active=false), don't delete — these may be
> legitimate content for a future class-5 rollout."

The measurement was right and the conclusion was backwards. **The client's
domain was the defect, not the data**, and
`question_bank_class_level_check` then wrote the client's mistake into the
schema. This is that rollout.

**Six homes for one domain, now one.** `6|7|8|9|10|11|12` was written out
separately in `curriculumScope.parseClassLevel`, `taxonomy/canonicalize`,
`taxonomy/humanize`, `taxonomy/registry`, `ncertSyllabus.parseClassGrade`, and
the `ClassLevel` union in `taxonomy/types`. A Class 5 label parsed to `null` in
all six, so the tag filter §10.9 depends on had nothing to filter by. They all
now derive from `CLASS_LEVELS` in `@/lib/curriculumScope`. The Roman-numeral
branch gained `V` — and was reordered longest-first, because `X` ahead of `XII`
reads a Class 12 label as Class 10.

**The range is gone and nothing replaced it** (`20260914020000`). A range is a
literal that drifts; the curriculum already knows which classes exist. Every
keyed question resolves a class through `chapter_id -> chapters ->
curriculum_subjects -> curriculum_classes.level`, so `class_level` was a
duplicate — the two-homes shape (G9) waiting to disagree.
`tg_question_bank_class_follows_chapter` now fills it from the chapter when
omitted and refuses any row where the two disagree. A CHECK could not do this:
it may not run a subquery. Adding Class 4 later is a seeding job, not a code
change.

Measured before writing it, across all 21,696 rows: 15 with no chapter, **0**
chapters that fail to resolve, **0** rows disagreeing with their chapter, and
2,189 of 2,189 Class 5 rows keyed to genuine Class 5 chapters.

**Live after:** Class 5 `2189 active / 2189 total`. The bank went from 19,492 to
21,681 active questions. The 15 unkeyed rows chunk 7A retired stay retired —
§10.10 is untouched, and probe29 asserts that as a positive control.

**Verified** by probe29's 7 caller assertions (260 total): a teacher saves a
Class 5 question; omitting `class_level` fills it from the chapter; tagging a
Class 12 chapter as Class 5 is refused with the §10.9 reason in the message; an
unkeyed active question is still refused; no Class 5 question is left archived.
And in the browser, the question bank's class picker now opens on Class 5 and
the CSV import saves against it.

The original finding follows.

**Found 2026-09-07 while fixing issue 11. Not fixed: it is a ruling, not a bug.**

Two parts of the schema disagree about whether Class 5 exists.

| Measured | |
|---|---|
| `curriculum_classes` | Class 5 seeded — 4 subjects, **55 chapters** |
| `question_bank` rows at `class_level = 5` | **2,189** |
| ...of those, `is_active` | **0** |
| `question_bank_class_level_check` | `CHECK (is_active = false OR (class_level IS NOT NULL AND class_level BETWEEN 6 AND 12))` |

So the constraint is what deactivated all 2,189. They are keyed, gradable and
sitting in the table; nothing serves them, and nothing can, because activating
one violates the check.

**Why this is a ruling and not a fix.** Making Class 5 savable is one line
(`QUESTION_BANK_CLASS_LEVELS.min`) plus a migration widening the constraint —
but it would also make 2,189 existing questions eligible to be served to
students, and whether the platform teaches Class 5 at all is a product decision
with a data consequence. The opposite reading is just as consistent with what is
live: Class 5 is seed residue and the curriculum rows should go.

**What was done instead.** The question bank's class picker offers only
`QUESTION_BANK_CLASS_LEVELS` (6–12), read from one named constant in
`questionBankService.ts` whose comment carries this measurement. A teacher can
no longer pick a class whose every save would be refused as "One of the values
isn't valid." Nothing was activated, deleted or widened.

**To resolve, someone has to answer:** does Gurukul serve Class 5? If yes, widen
the constraint and decide whether the 2,189 are reactivated wholesale or
reviewed. If no, the Class 5 curriculum rows and those questions should be
retired together, and the chapter tree stops claiming a class that has no
students.

## 28. ~~`TestService.setQuestions` sends a `kind` column that does not exist~~ — FIXED

**FIXED 2026-09-08, and it was broken at BOTH ends.** The entry asked for the
first thing to establish — "whether any teacher-facing screen actually calls
`setQuestions`". It does: `src/gurukul-teacher/LiveClassPanels.tsx:1113`, when a
teacher builds a test by hand or from the library. So this was a broken feature,
not dead code.

**The teacher half.** Every row carried `kind: mapKindToDb(q.kind)` and
`public.test_questions` has no `kind` column, behind an
`.insert(rows as never)` cast — PostgREST rejects an unknown column with
PGRST204 before the database sees it. **No manually built test ever saved a
single question.**

**The student half, which is why nobody noticed.** `QuestionRenderer` — the only
component that draws a test question — branches entirely on `q.kind`:

```tsx
{(q.kind === "mcq" || q.kind === "multi") && ...options...}
{q.kind === "numerical" && <Input type="number" .../>}
{q.kind === "short" && <Textarea .../>}
```

and `rpc_test_questions_for_attempt` returned **no format at all**. So `q.kind`
was `undefined` for every question a student was ever served, no branch matched,
and the paper would have rendered as a list of stems with **no way to answer any
of them**. Nothing could be saved, so nothing could be rendered, so neither half
could reveal the other.

**The fix.** `question_format` (added by `20260914050000` for entry 16) already
carries exactly the vocabulary the renderer wants, so both ends now speak it:

- `setQuestions` writes `question_format`, and splits the answer per
  `test_questions_shape_matches_format` — the key in `correct` for
  mcq/multi/numerical, the model answer in `answer` for short/long, never both.
  `long` is no longer collapsed into `short`.
- The `as never` cast is gone, so the compiler checks the row shape. It
  immediately caught `toOptions`/`toCorrect` returning `unknown`; both are typed
  `Json` now.
- `20260914060000` adds `question_format` to `rpc_test_questions_for_attempt`
  and to `rpc_test_submit`'s result payload — the review screen draws through
  the same component, so without it a student reviewing their own submitted
  paper would see their answers vanish.
- `correct`, `answer` and `explanation` stay OUT of the attempt path (G14). The
  format is how a question is drawn, not part of the key.

**A defect I introduced and caught within minutes, recorded because the shape
recurs.** Adding a column to a `RETURNS TABLE` needs `DROP FUNCTION` first
(42P13) — and **a DROP takes the grants with it**. The recreated function came
back with default privileges, Chunk 9.5 revokes EXECUTE from PUBLIC across this
schema, so `authenticated` had none and every student sitting a test got
`permission denied for function rpc_test_questions_for_attempt`. Seven
assertions failed at once and **every one of them was a positive control** — a
suite of denial tests would have gone green on a function nobody could call.
Restored by `20260914070000`, which also asserts PUBLIC still does not hold it.

**Verified** by probe32's 9 caller assertions (291 total): a `kind` insert is
still rejected (the original defect, pinned), the shape the service now writes
is accepted, every served question carries its format and it is the format that
was written, the key is still withheld, a right answer scores its marks, and the
review payload carries the format too.

The `correct`-shape disagreement this entry also noted is real and unchanged:
`toCorrect` writes `{indexes:[i]}` / `{value}` / `{text}`, which is exactly what
`QuestionRenderer` and `rpc_test_submit` expect, while the 576 pre-existing rows
hold a bare jsonb string. Those 576 were written by something else and would
never grade against this client. They are seed data for tests nobody has taken;
left alone deliberately rather than rewritten on a guess.

The original finding follows.

**Found while ruling on entry 16. NOT fixed: it is a defect with its own
verification needs, not a ruling, and folding it into a schema decision would
have hidden it.**

`src/academic/services/testService.ts` builds every row as

```ts
const rows = questions.map((q, i) => ({
  test_id: testId, order_index: i,
  kind: mapKindToDb(q.kind),          // <- public.test_questions has no `kind`
  ...
}));
await getClient(repo).from("test_questions").insert(rows as never)
```

`public.test_questions` columns, measured: `id, test_id, school_id, order_index,
question, options, correct, marks, explanation, chapter_id, chapter, concept,
created_at` (plus `question_format` and `answer` as of `20260914040000`). **There
is no `kind`.** PostgREST rejects an unknown column with `PGRST204` before the
database sees it, so this is the same shape as KNOWN_ISSUES 11's `school_id`, in
a different table — and the `as never` cast is again what hides it from the
compiler.

**A second disagreement in the same function.** `toCorrect` writes
`{indexes:[i]}` for MCQ, `{value}` for numerical and `{text}` for short, while
all **576** existing `test_questions` rows hold `correct` as a bare jsonb
**string**. `rpc_test_submit` grades with `a.response = q.correct` — plain jsonb
equality — so the two shapes cannot both be right. Whichever path wrote the 576
rows was not this one.

**Not measured:** whether any teacher-facing screen actually calls
`setQuestions` today, and therefore whether this is a broken feature or dead
code. That is the first thing to establish, because it decides whether the fix
is a column, a data migration, or a deletion.

**Related and already handled:** `mapKindToDb`'s vocabulary (`mcq | multi |
numerical | short`) is what `test_questions.question_format` now uses, so the
column this code wanted exists — under a different name and with `long` added.
Whoever fixes this should write `question_format`, and put a short/long model
answer in `answer`, never in `correct` (`test_questions_shape_matches_format`
now refuses that outright).

---

## Housekeeping — 75 dead files removed, 2026-09-08

`scripts/lint-unreferenced-src.mjs` (new) walks the import graph from
`index.html`'s entry and every test file, and reports what it never reaches.
Reachability is a graph question: a file imported only by a file nothing
imports looks "referenced" to a grep and is still dead.

**70 files under `src/`** were reachable from nothing. They were not random —
they were four superseded designs left in place:

- the `battleground/Arena*` cluster (8 files). `pages/student/Battleground.tsx`
  says so in a comment: *"ArenaHub intentionally not mounted as product home —
  design Battleground is canonical."*
- the `student/analytics/*` cluster (8), including a `wisdom/` subtree
- `AppLayout` + `NavLink` + `NotificationBell` — a superseded shell
- `academicBrain` / `academicAgents` / `useAcademicBrain` / `useAcademicCoach`
- 30 unused shadcn components (the app uses `sonner`, not the shadcn toast kit)
- two `@deprecated` re-export shims kept "so parallel supervisors do not
  diverge on APIs" — a coordination that ended long ago
- `src/engines/class12Math/*`, whose live twin is `scripts/math12Catalog.mjs`
  ("mirrors …/buildCatalog.ts") — two homes, one of them never running

Plus **5 scripts**: four headed "One-shot codemod" whose output is already in
the tree, and `run-verifications.mjs`, a superseded duplicate of
`run-verification-files.mjs`.

**KEPT deliberately, and why:**

- `src/test/setup.ts` — unimported, but `vitest.config.ts` names it in
  `setupFiles`. Load-bearing by convention, which is exactly the case a
  reachability scan gets wrong on its own.
- `docs/APPLY_*.sql` (46 files) — cross-referenced by ten documents. They are
  the record of what was applied by hand before the migration ledger existed.
- `supabase/functions/send-otp` and `verify-otp` — deleted from the PROJECT
  (issue 8b), source kept so the deletion stays reversible.
- Hand-run gates and generators in `scripts/` that `package.json` does not
  name: `run-verification-files`, `seed-gate`, `query-timing`,
  `mint-role-sessions`, `gen-tenant-fence-migration` and the rest. Not being
  wired to an npm script is not the same as having no use.

**Proof it was dead:** typecheck clean, `npm run build` succeeds, 636 tests
pass, every screen still reachable from a router, and lint fell from
**134 errors / 77 warnings to 122 / 71** — the deleted files were carrying that
debt. The baseline was lowered so the ratchet keeps meaning something.

---

## 29. ~~576 answer keys were written as labels and read as positions~~ — FIXED

**FIXED 2026-09-08 by `20260914080000`. This was the second half of entry 28,
left there as "seed data for tests nobody has taken". It was worse than that:
no student could have been marked right on any of them.**

`rpc_test_submit` marks with plain jsonb equality —
`is_correct = (a.response IS NOT NULL AND a.response = q.correct)` — and
`QuestionRenderer.tsx:84` sends `{"indexes":[i]}` when a student picks option
`i`. Every one of the 576 rows held the option's **text** instead:

    correct is a jsonb string ................... 576 of 576   (all 'mcq')
    the string is one of the row's own options ... 576 of 576
    the string matches MORE than one option .....   0
    rows where correct is an object .............   0

`{"indexes":[0]} = "a"` is false, so the answer was unreachable — not a wrong
key, but no key the student could have matched.

**Why the constraint did not catch it.** `test_questions_shape_matches_format`
existed, was VALIDATED, and passed all 576, because for a choice question it
only asserted `correct IS NOT NULL`. A constraint named for a shape it does not
check is the G11 shape: it reads as coverage and provides none. The name is now
true — mcq/multi require an `indexes` array, numerical a `value`.

**Where the shape came from, and why nobody noticed.** Not the client:
`TestService.toCorrect` has written positions since `20260914040000`. All 576
came from `supabase/fixtures/SCALE_FIXTURE.sql`. Four more writers held the same
shape and are corrected: `SEED_DEMO_DATA.sql`, `CHUNK75_VERIFY.sql`, and the
fixtures inside probe7 and probe31.

`CHUNK75_VERIFY` is the reason this survived. It keyed its questions by text
**and answered them by text**, so it agreed with itself and with nothing else,
and reported a green end-to-end run over a paper no real client could have sat.

**No re-marking question:** `test_answers` held 0 rows, so no stored
`is_correct` and no stored score was ever computed from the old shape.

**Verified** by probe33: a label key is refused, a position key accepted, the
right option scores and the wrong one does not — both on the same attempt,
because `test_attempts` carries a UNIQUE (test_id, user_id) and
`rpc_test_submit` closes the attempt it marks.

**The range gap this entry first recorded as accepted is CLOSED**, by
`20260914110000`. A CHECK may not run a subquery, so it cannot compare an index
against `jsonb_array_length(options)` — which left `{"indexes":[7]}` on a
two-option question writable, and exactly as unmarkable as the label shape.
`tg_test_question_key_addresses_an_option` refuses that, an empty `indexes`
array, and a numerical key holding a STRING (jsonb equality is typed, so
`'"4"' <> '4'` and the renderer sends `Number(...)`). A trigger, for the same
structural reason `tg_question_bank_class_follows_chapter` is one. probe33
asserts all three refusals plus two positive controls — the LAST valid index
(n-1) and a real numeric key — without which a trigger that refused everything
would pass.

## 30. ~~A signed-out visitor could call two school helpers~~ — FIXED

**FIXED 2026-09-08 by `20260914090000`. One of the two was introduced by me the
day before.** Found by `node scripts/run-verification-files.mjs`, which nothing
was wired to run:

    (FAIL) 1: anon can EXECUTE these and no class explains why —
    my_visible_exam_ids(), storage_object_owner_school_id(text)

`anon` is the key that ships in the browser bundle, so this is what anyone can
call signed out, with curl.

`storage_object_owner_school_id(text)` was created by `20260914010000` — the §7
storage fence — which revoked PUBLIC and then wrote
`GRANT ... TO anon, authenticated, service_role`. That triple is the Supabase
default and was copied without asking whether a signed-out visitor needs a
SECURITY DEFINER function that resolves an uploader's school. It does not: both
buckets it serves are private, so anon never evaluates that policy.

`my_visible_exam_ids()` was left behind by `20260909000000`, which replaced it
in `exams_read` with the row-local `can_read_exam_row`. Measured across policies
(USING and WITH CHECK), function bodies, views and constraints: **0 references.**
Dropped rather than re-granted.

**Verified** by probe35, which asks from the other end — it becomes `anon` and
tries the call, because a grant table and an actual refusal are not the same
claim. Positive controls carry the weight: a signed-in student still resolves
the storage helper, `can_read_exam_row` still answers, and exams still read. A
revoke that cut off the legitimate roles would have satisfied the anon gate
perfectly while making every academic file unreadable.

## 31. ~~Six verification files could not run, and one lied~~ — FIXED

**FIXED 2026-09-08.** `run-verification-files.mjs` reported **6 ROTTED, 2
FAILED** of 33. Nothing ran it — it was in no npm script — which is why entry 30
sat undetected underneath the noise.

Each rotted file died on ONE obsolete reference and took 6–10 still-valid
assertions with it, so five were repointed rather than deleted:

| file | referenced | now |
|---|---|---|
| `CHUNK4_VERIFY` item 7 | `attendance_audit` | `academic_audit` (Chunk 9 folded it) |
| `CHUNK67_BATCH2` item 7 | `attendance_audit` | `academic_audit` |
| `CHUNK5_VERIFY` item 8 | `rpc_purge_deleted_homework()` | `rpc_purge_expired()` |
| `CHUNK7B_BATCH2D` item 4 | `parent_academic_alerts` | asks the catalog — the table is gone, which is stronger than counting 0 rows in it |
| `CHUNK7A_VERIFY` item 4 | a class_level disagreeing with its chapter | a chapter of ANOTHER class |

`CHUNK7A` is worth its own line: `20260914020000` made a question's class derive
from its chapter, so the fixture's wrong-class row became structurally
impossible and the insert raised 23514. The fix was not to re-open the
disagreement — it plants the only wrong-class question that can still exist, one
keyed on another class's chapter, and so tests the real path.

`CHUNK67_BATCH2` item 7 then reported a genuine FAIL once it could run: a
teacher read 0 audit rows. That expectation was the stale part — it said
"staff-only", and §10.18 (`locked-decisions.md:154`) says "Cannot see the audit
log — admin only". Rewritten to teacher 0 / student 0 / **admin > 0**, the admin
being the positive control without which "everyone sees 0" passes.

**`CHUNK47_VERIFY.sql` was DELETED**, not repointed: it is *about* the removed
table across items 7, 8 and 10, and probe21 supersedes it claim-for-claim as the
caller.

Now `32 files: 32 ran clean, 0 failed, 0 rotted`, and it is wired as
**`npm run verify:chunk-files`** so it cannot rot silently again.

## 32. ~~`attendance_locks` outlived the chunk that replaced it~~ — FIXED

**FIXED 2026-09-08 by `20260914100000`.** Two verification files had been
asserting this table was gone and it was still there — CHUNK47 item 10 said
"attendance_locks does not exist anywhere", CHUNK2 section 7 expected 0 and
measured 1. Chunk 4.7 replaced the lock with `attendance_submissions` (a day is
locked because it was submitted — one fact instead of two that can disagree) and
never dropped the table.

    rows 0 · inbound FKs 0 · functions naming it 0 · policies naming it 0
    references in src/ 0 (only the generated types.ts)

It was also an unfenced surface: ACL `anon=arwdDxtm`, and its only SELECT policy
was `USING (true)` for `authenticated` with no `same_school` predicate of any
kind. Empty, so nothing leaked; a dead table is still no place to leave a fence
open. Dropped rather than fenced, because fencing keeps a second home for "is
this day closed?" alive — the thing 4.7 removed on purpose. The rollback
recreates the table, its key, RLS, all three policies and the grants as
measured.

`scripts/lint-tenant-scope.mjs` was still listing both `attendance_audit` and
`attendance_locks` among its tenant-scoped tables; both entries are gone.

## 33. ~~`lint:tenant-scope` was failing, on two functions I wrote~~ — FIXED

**FIXED 2026-09-08.** The gate reported three functions touching a
tenant-scoped table with no `school_id` anywhere in the body, two of them from
`20260914030000` — the question-bank approval queue built the day before.

All three are genuine allowlist cases, and each entry records what was measured
rather than an assurance: `question_bank` has **no `school_id` column at all**
(0 of 33 — it is a G2 global table), so there is no tenant predicate available
to add. What bounds `rpc_question_bank_review_queue` and `rpc_review_question`
is the ACTOR: both open with `IF NOT (SELECT public.is_super_admin()) THEN
RAISE`, citing §10.20, and `rpc_review_question` is defended a second time at
row level by `tg_question_bank_approval_is_super_admin_only`.
`rpc_purge_expired_battle_reports` is the same shape as the already-allowlisted
`rpc_purge_expired`: it RAISEs when `auth.uid() IS NOT NULL` and its proacl is
postgres/service_role only (measured: anon false, authenticated false).

**Still open, deliberately:** `Analysis.tsx` was removed from
`lint-metric-duplication`'s baseline (converged in f6e2f51), leaving a backlog
of **10** sites still computing a metric outside the metric layer. That is a
backlog the gate holds flat, not a defect this session introduced.

## 34. ~~A generation that produced nothing was sold as a success, and billed~~ — FIXED

**FIXED 2026-09-08. Found because the evidence suite failed and I went looking
for a provider outage that was not there.**

`dpp-generate-questions` returned, verbatim:

```
200 {"questions":[],"source":"openrouter_qwen","question_format":"mcq","board":"rbse","class_level":null}
```

A 200 with an empty array. The function only refunded on `!result.ok`, and
`result.ok` is TRUE when the model answers with well-formed but empty JSON — so
the reservation was never released. **That is KNOWN_ISSUES 14 surviving in the
one path its fix did not cover:** the student was billed for nothing and told it
worked. No caller can tell that response from a real generation.

Now: refund, then `502` with "Nothing was charged — please try again."

**A second defect in the same function, found while reading it.** Two hardcoded
`lvl >= 6 && lvl <= 12` ranges — the same literal `20260914020000` removed from
the database, where it had archived 2,189 legitimate Class 5 questions. Here it
was worse than a filter: the FIRST of the two decides the prompt, so a Class 5
request produced a prompt with **no class in it at all** and the model pitched
the question wherever it liked. §10.9: "a Class 5 student is only ever served
Class 5 content for their own board." Both now resolve the class against
`curriculum_classes`, so the domain is data, not a literal.

Deployed and verified in the browser: a student generated *"A pizza is divided
into 8 equal slices. If Rohan eats 3 slices, what fraction of the pizza did he
eat?"* with four options and `correct_index: 1`.

## 35. ~~`npm run ai:ping` could never pass~~ — FIXED

**FIXED 2026-09-08.** The connectivity check for the whole AI path sent
`max_tokens: 16` and **no `reasoning` field**. Qwen 3.7 Flash is a reasoning
model: left enabled it spends its budget on the internal trace before writing
anything to `content`, so the reply came back `content: null`,
`finish_reason: "length"`, and the script printed `FAIL: empty model response`
— which reads as "the provider is down".

Measured, same key, same model, same prompt:

    max_tokens 20, no reasoning field ..... content null    (trace only)
    max_tokens 2000, enabled:false ........ content "pong", 1 completion token

`supabase/functions/_shared/modelRouter.ts:141` has sent
`reasoning: { enabled: false }` on every real call for some time — the probe
simply did not. **A gate that cannot pass while the path is healthy is worse
than no gate**: it sends the next reader hunting an outage that is not there. It
did exactly that here, for about an hour.

Also: a `429` is now named separately (exit code 2), because
"qwen/qwen3.7-flash is temporarily rate-limited upstream" from Alibaba is not a
broken path, and reporting it as one sends you to the wrong place. And an empty
reply now says WHY — reasoning-trace-ate-the-budget is a request problem, a
genuinely empty answer is the provider's.

`npm run ai:ping` → `{"ok": true, "text": "pong", "reasoning_tokens": 0}`.

## 36. ~~A signed-out visitor could read every school's attendance edits~~ — FIXED

**FIXED 2026-09-08 by `20260914120000` and `20260914130000`.**
`npm run db:verify-integrity` had been reporting it and nothing had acted:

    FAIL  every view in public is security_invoker  -- [{"relname":"attendance_day_edits"}]

It is the only view in `public` without it — `attendance_current`,
`students_current` and `trash` all have it — so it ran as its owner and RLS
never applied. Asked as each role rather than inferred from the grant table:

    anon (the browser-bundle key) ... 20 rows, 1 school
    a student ....................... 20 rows, 1 school
    the owner (ground truth) ........ 20 rows, 1 school

Identical. A signed-out visitor saw exactly what the table owner saw. Only one
of the two schools currently has edits, so nothing was crossing schools *today*
— nothing was stopping it either, and `school_id` is a column it returns.

**It is deliberately still not `security_invoker`,** and that is now recorded
rather than implicit: the view reads `academic_audit`, which §10.18 reserves to
admin, so a principal can see that a figure moved without being handed the audit
log. Flipping the flag would have silently emptied the marker for the people who
use it, with every gate green. So both fences live in the view body —
`my_accessible_school_ids()` for the school, and the role set
`AttendanceService.summarizeSchoolDate` already enforces
("School attendance summary is admin/principal-only") for the caller. The
service and the database now agree; before, only the service did.

The integrity check was rewritten to match: a non-invoker view passes **only
while both fences are present in its body**, exactly one such view may exist and
it is named, and no non-invoker view may be readable by anon. Remove a fence and
it goes red again — which a name-based allowlist would not have done.

probe36 asserts it as the caller: anon refused, student 0, teacher 0, admin
sees their own school's 20 and another school's 0, and all five columns the
service reads are still there.

## 37. ~~An integrity check demanded the defect back~~ — FIXED

**FIXED 2026-09-08.** `db:verify-integrity` asserted
`question_bank.class_level 5/null archived (expect 0 active)` and reported
**2,189** — because `20260914020000` reactivated exactly those rows, on §10.9's
instruction. The check encoded `20260821120000`'s ruling, which had been
overturned; left alone it would have argued for re-archiving Class 5.

Replaced with the rule that holds now, in both directions: Class 5 questions ARE
active (§10.9), no active question is unkeyed (§10.10), and every keyed question
agrees with its chapter's class — the invariant
`tg_question_bank_class_follows_chapter` makes structural.

`npm run db:verify-integrity` now reports **All checks passed** for the first
time.

## 38. ~~An upstream rate limit read as a product regression~~ — FIXED

**FIXED 2026-09-08.** The live-provider generation test failed in the full
evidence suite and passed every time it ran alone. Measured cause, from the run
itself rather than assumed:

```
OpenRouter error 429 on qwen/qwen3.7-flash: "qwen/qwen3.7-flash is
temporarily rate-limited upstream. Please retry shortly."
```

That is Alibaba throttling, not Gurukul breaking. It only appears in the full
suite because several provider calls land before it — the refund test in the
same describe block, and the Tier 5 AI-coach test — so the order is what
triggers it, and running the test alone can never reproduce it.

**The product was right.** `dpp-generate-questions` treated the 429 correctly:
`result.ok` was false, so it refunded the reservation and propagated the error.
Nothing needed fixing there. The test was hard-failing on a provider condition.

**The skip is not a free pass.** What can still be proven when the provider
refuses is exactly what KNOWN_ISSUES 14 is about — a call that produced nothing
costs the school nothing — so the refund is asserted BEFORE skipping. A
permanently rate-limited provider now shows up as a loud skip with the refund
still enforced, never as a silent green. 429/503 are the provider refusing;
502 is this function's own "the model answered with no questions" (entry 34).

**A defect in the first version of that fix, caught before it landed.** It
asserted `expect(after).toBe(before)`. `readUnits` returns `null` when no usage
row exists yet for the day, and a reserve-then-refund can leave the row at 0 —
so null vs 0 would have failed for a bookkeeping detail rather than a charge,
and if both were null it would have passed vacuously. Both sides are normalised
with `?? 0` now, because "no row" and "0 units" are the same fact, and the
assertion states the real invariant: the refused call did not INCREASE what the
school owes.

This is the same shape as `aa-reachability.spec.ts`, which exists so a network
outage reads as one red line instead of a hundred plausible product regressions.
An outage and a throttle are both the world being unavailable; neither is a
defect in this app, and both had already sent a reader hunting one — twice on
the day this was written.

## 39. ~~Every teacher test write was addressed to a schema that had not existed for weeks~~ — FIXED

**FIXED 2026-09-09.** Found by writing the probe KNOWN_ISSUES 23 says was
missing, and confirmed in the data before a line was changed:

```
72 tests · 0 published · tests.status holds exactly one value ('submitted')
```

All 72 came from seed SQL. **Not one test in this project was ever created
through the app.**

Chunk 7.5 replaced `tests.class_id` with `section_subject_id` (§10.22) and
dropped `is_published` in favour of `status`. The READ half of `testService.ts`
was updated for that — `isPublishedFlag` and `listForClass` both carry comments
explaining the drop — and the WRITE half was not:

```
sent, and not on `tests`   class_id · subject · is_published ·
                           question_count · subject_id · max_marks
required, and not sent     section_subject_id (NOT NULL)
                           max_mark          (NOT NULL, and the real column
                                              is SINGULAR — it sent the plural)
```

Measured as the caller, probe37:

```
ok  TestService.create — the payload it sent BEFORE the rewrite
      ERROR: column "class_id" of relation "tests" does not exist
ok  TestService.create — its old fallback payload (no escape hatch)
      ERROR: column "class_id" of relation "tests" does not exist
```

**The fallback repeated the defect it existed to survive.** `create` inserted
`extended`, and on any error retried with `base` — which carried four of the
same six phantom columns and omitted the same two NOT NULL ones. A retry that
cannot succeed is not a fallback, it is a second copy of the bug.

`update`, `publish`, `archive`, `schedule`, `setQuestions` and `remove` each
read `class_id` off a row that has none, so `String(existing.class_id)` was the
literal `"undefined"`, handed to the class-ownership guard at 14 sites.

**The file was rewritten rather than patched**, because the whole write half was
addressed to the old shape and a six-column patch would have left the next
reader believing the rest was checked. Every write path now resolves its class
through the section-subject anchor (`sectionIdOfTest`), and creating one
resolves the other way (`resolveSectionSubjectId`) — which **refuses rather than
guesses** when a class teaches several subjects and the caller named none.
Filing a Physics test under Mathematics would be silent and permanent.

**Three things found while rewriting, all fixed here:**

* **The principal could create, edit, publish and delete tests.** The guard
  opened `if (isSchoolOperator(ctx.role)) return;`, and `isSchoolOperator` is
  admin OR principal. §10: the principal "cannot create or edit any record
  except announcements".
* **`question_count ?? 0` printed "0 Q" against every test** in the teacher's
  list. The column does not exist. The count is now counted from
  `test_questions` — as a separate staff-only call, because that table is
  closed to students (G14) and embedding it in the shared list query would
  break the student's own test list.
* **Every `test.published` event went out with no subject.** The payload read
  `existing.subject`, and a test has no subject column — it comes from the
  anchor. Now `subjectOfTest()`.

Callers re-checked, all 30 sites across 8 files: `LiveClassPanels`,
`TestAttempt`, `TestResult`, `Tests`, `Calendar`, `gurukul-teacher/Dashboard`,
`ParentLiveAcademic`, `services/index`. Three of them read the phantom columns
as dead fallbacks and were cleaned. `listQuestions` was nearly broken in the
rewrite — it gates on `get()` first, handles **parent** as well as student, and
passes `_attempt_id` (via `startAttempt`), not `_test_id` — and was restored
verbatim after checking the original.

## 40. ~~`tests_insert` refused every insert, by looking up the row being inserted~~ — FIXED

**FIXED 2026-09-09 by `20260915000000`.** The policy was

```sql
tests_insert  INSERT  WITH CHECK (can_manage_test(id))
```

and `can_manage_test` is `SELECT EXISTS (SELECT 1 FROM public.tests t WHERE
t.id = _test_id …)`. It looks the new row up **in `tests`**, by the id the row
is being given. On an INSERT that row is not visible to the function's snapshot
— it is STABLE — so the predicate is false and every insert is refused.

This is a SECOND, independent blocker: even with the columns corrected, the
insert was refused. It surfaced because probe37's **positive control failed**:

```
FAIL  the same teacher, the columns tests actually has (positive control)
        ERROR: new row violates row-level security policy for table "tests"
```

A denial with no positive control would have read as proof that the column fix
was enough.

`can_manage_test` is **not** touched — `tests_update` and `tests_delete` use it
and are correct there, because by then the row exists. INSERT got its own
predicate over the new row's values: the anchor must belong to the same school,
`created_by` must be the caller (§8, credited to whoever created it), and the
caller is admin or teaches that section (§10.5). The principal is deliberately
absent (§10).

Same family as `students_read` (entry 21) and `exams_read` before it. There a
self-referential policy broke `INSERT … RETURNING`; here it broke the INSERT.

## 41. ~~Two of the three buttons in the test builder wrote a status the database refused~~ — FIXED

**FIXED 2026-09-09 by `20260915010000`.** `tests_status_check` admitted
`draft`, `published`, `submitted`. `TestService` declares four and writes two
the constraint refused:

```
TestService.schedule() -> 'scheduled'  -> 23514
TestService.archive()  -> 'archived'   -> 23514
```

The builder's review step offers **Save draft · Schedule · Publish** side by
side. Two of those three wrote a value the database threw out.

Meanwhile `submitted` is in the constraint and **nothing in the application
writes it** — all 72 rows carry it because they came from seed SQL. The
vocabulary and its writer had drifted in both directions.

Widened rather than narrowing the app: the table already carries
`scheduled_publish_at` and `archived_at`, so the schema expected both states;
only the enum was left behind. Nothing in the database reads this vocabulary —
`my_readable_test_ids` and `my_manageable_test_ids` do not mention status, and
no `public` function referencing `'scheduled'` touches `tests`. `submitted` is
KEPT: dropping a value 72 rows satisfy would make them un-updatable, which the
rollback refuses to do for the same reason.

probe37 asserts all four the builder offers are accepted, and the migration
refuses to commit unless the CHECK still rejects a value outside the vocabulary
— a wider CHECK that accepts everything is an absent one.


## 42. ~~No student could hand in a class test~~ — FIXED

Found 2026-09-09 by `e2e-evidence/tier1-panels.spec.ts` driving the student
attempt route in a real browser for the first time. The attempt screen rendered
the question, took the answer, and then stayed on
`/student/test/<id>/attempt` for ever. The attempt row stayed `in_progress`.

```
rpc_test_submit(_attempt_id uuid, _answers jsonb)   -- pronargdefaults = 0
```

`_answers` had **no default**, so PostgREST treated it as required. Nothing
sends it: `TestAttempt.tsx` saves each answer as it is chosen, then calls
`TestService.submitAttempt(ctx, attemptId)` with no answers, and the service
omits the parameter rather than sending null — the documented repo pattern for
an optional RPC argument. PostgREST looked for a one-argument
`rpc_test_submit`, found none, returned PGRST202; the page caught it, raised a
toast, and stayed put.

The generated types said so all along — `Args: { _answers: Json; _attempt_id:
string }`, both required — but `testService` casts the payload `as never`, so
the compiler never got to object. **That cast is why a typecheck-clean tree
shipped a dead submit button**, and it is worth remembering the next time a
service reaches for `as never`.

Fixed by `20260916140000` giving `_answers` `DEFAULT NULL`. The body always
read `jsonb_array_elements(COALESCE(_answers, '[]'::jsonb))`, so the
incremental-save path the page uses was the intended one and only the signature
disagreed. The migration refuses to commit unless `pronargdefaults = 1` and the
body still COALESCEs the argument.

## 43. ~~The attempt screen's "n/N answered" counter does not count~~ — FIXED

Opened 2026-09-09 with a guess, closed 2026-09-10 with a measurement. The guess
("a remount, or a second `load()` resetting `responses` from a read that raced
the save") was the right shape and the wrong mechanism, and the wrong mechanism
would not have been fixed by the obvious change.

**What it looked like.** A student clicks an option; the counter reads
`1/1 answered`; ~250ms later it falls back to `0/1` and stays there for good.
Sampled in the browser at t+0/100/250/500/1000/2000/4000/8000/12000ms:

```
t+0ms     counter=1/1 answered
t+100ms   counter=1/1 answered
t+250ms   counter=0/1 answered     <-- clobbered
t+12000ms counter=0/1 answered
```

**The mechanism.** `load()` opened with

```ts
if (startedForIdRef.current === id) return;   // checked here
...four awaits...
startedForIdRef.current = id;                 // set here
```

The guard was checked on entry and assigned four awaits later, so it could not
stop CONCURRENT runs — only sequential ones. The effect's deps are
`[id, user, ctx, academicReady]`, and `user`, `ctx` and `academicReady` each
settle at a slightly different moment during mount, so several effect runs
arrived inside that window and every one of them passed the check. Measured:
**six `rpc_test_start` calls for a single mount**. Each of those loads ends with
`setResponses(m)` built from `listAnswers()`, so whichever one resolved after the
click replaced the student's answer with the server's older view.

That is also why it looked intermittent. Whether the clobber landed depended on
whether a load happened to resolve after the click, which is why one run left
`test_answers` populated and the next left it empty.

**The fix** (`src/pages/student/TestAttempt.tsx`), two independent halves:

1. `loadRef` holds the in-flight *promise* keyed by test id and is assigned
   BEFORE the first await, so a second caller joins the first load instead of
   starting another. Cleared on failure so a later dep change — or the Retry
   button — can still retry, which is what those deps were for. 6 → 2
   `rpc_test_start` calls (the remaining 2 are React StrictMode's dev
   double-mount; production does 1).
2. `locallyEditedRef` records every question the student has answered, marked
   synchronously in `persist()` before the save is queued. A load that resolves
   later now merges rather than replaces: the server's map wins for untouched
   questions, the student's own edit wins for theirs. Answering is instant and
   saving is a round trip, so this ordering will always be possible.

Either half alone would hide the symptom; both are kept because they fix
different things — one stops the redundant loads, the other makes any load that
does happen non-destructive.

**Proof.** `e2e-evidence/tier1-panels.spec.ts` now asserts the counter reads zero
BEFORE the click (the positive control — without it the assertion after the click
would also pass on a page that always said "1/1"), that it moves on the click,
and that it is STILL moved 3s later once every in-flight load has settled. Run
against the unfixed file the suite is 13/14 and the only failure is
"the answer survived the loads that resolve after the click"; with the fix it is
14/14.

**A second defect the same investigation found**, in the test rather than the
app: the spec chose its answer with `if (await choice.count())`, and `count()`
races the render — it returns 0 while the question is still painting, so the
click was silently skipped and the paper submitted empty. That is how a run
recorded `answers_saved = 0` while reporting green. It now waits for the option
to be visible, so "no options" and "no options YET" are no longer the same
answer.

## 44. ~~The practice timer records nothing~~ — WRONG DIAGNOSIS, corrected 2026-09-11

**I wrote this entry on 2026-09-10 and the conclusion was wrong. The counts in
it were right; what I inferred from them was not.**

What I said: "258 of 262 practice sessions finish with no elapsed time — the
timer is not recording." What is actually true: **only four practice sessions
have ever been completed through the app**, and the timer recorded all four
perfectly.

THE MEASUREMENT THAT SETTLED IT

`rpc_finish_practice_session` rolls a session up from `question_attempts`:

```sql
COALESCE(sum(time_taken_ms), 0)::int INTO ... _time_ms
FROM public.question_attempts WHERE session_id = _session_id AND user_id = auth.uid();
...
total_time_ms = NULLIF(_time_ms, 0),
```

Every session where that ran is internally consistent — all four of them:

```
correct_count = att_correct  AND  total_time_ms = att_ms     4 of 4
```

The other 240 finished sessions with attempts are seeded. Their signature is
unmistakable once you look for it:

```
question_count matches the attempt count      240 of 240
correct_count matches the attempts' correct     0 of 240
```

A sample: the session says 20 questions, 13 correct, 65% accuracy. Its twenty
attempt rows say **zero** correct. The session aggregates were written directly;
the attempt rows were generated separately; the finish RPC never ran on either.

WHY THERE IS NO BACKFILL

The attempts carry 121,680,000 ms — 33.8 hours — and rolling that onto the
sessions would be inventing a figure no student spent. It would also write
`correct_count = 0` over 240 sessions that currently claim 13, 9, 11 correct.
Making seeded data internally consistent is not the same as making it true, and
"do not fix an empty surface by inventing data" applies exactly here.

WHAT REMAINS TRUE

The Analysis tile now renders an em dash instead of `0h`, and that was the right
change for the right reason — 18 recorded minutes across the platform rounds to
zero hours, and reporting `0h` claims a measurement rather than admitting the
absence of one. That stays.

**The lesson worth keeping:** "258 of 262 rows lack a column" reads as a broken
writer. It was a quiet product fact — almost nobody has finished a practice
session. Four consistent rows disproved the writer theory in one query, and I
should have run it before writing the entry rather than after.

## 45. Revision "due now" equals "in queue" — NOT a scheduling bug

**Investigated 2026-09-10, at the v2 document's request: "Due now (16) equals
In queue (16), and Upcoming is 0 — everything is due at once. This may be a
genuine scheduling bug or a first-run state."**

**It is neither. The spacing is real and the queue is simply unattended.**

```
revision_queue    223 rows · 223 due · 0 upcoming
                  earliest 2026-08-09 · latest 2026-09-07
distinct due dates spread across a month, clustered 40 / 51 / 40
```

Items were scheduled across many different dates, which is what spaced
repetition looks like. Every one has since matured, because the latest due date
is 7 September and today is the 10th. Nothing has been revised, so everything is
due.

The counts were removed from the screen by the redesign anyway. Recorded here so
the next reader does not spend an afternoon looking for a scheduler defect that
is not there.

---

## Edge function deploy pipeline is broken

**Found:** 2026-09-10

The GitHub Actions workflow `deploy-edge-functions.yml` has failed on the last
3 runs (#61, #62, #63), most recently on 2026-09-06. CI-based edge function
deploys do not work; every function currently in production was deployed
manually via `supabase functions deploy`.

Not being fixed now — noted for awareness.

---

## Main is a deploy branch — no agent pushes

**Found:** 2026-09-10

Main deploys Supabase edge functions on push when `supabase/functions/**`
changes (`.github/workflows/deploy-edge-functions.yml`). This makes it
production infrastructure.

- Main forked from the live branch at `2b0cd6b`
- Live branch: `claude/gurukul-tier1-e2e-fixes-c0b3c3`, tip `3fdc65b`
- Main tip: `6947db5`

V2 student panel work was cherry-picked from main onto the live branch on
2026-09-10 (6 commits). Main is not the source of truth for app code.

**Rule:** No agent pushes to main. Merges to main are deliberate releases,
ruled on each time. Pushing a stale tree to main can roll back production
edge functions.
