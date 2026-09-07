# Known issues

Things found while building something else and deliberately NOT fixed there.
Each entry says what was measured, how it was measured, and why it was left.

Started 2026-09-04, build session 1 (XP write / test-generate-questions / Resources).

---

## 1. `requireAnyRole` in edge functions can never admit anybody

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

## 2. Students cannot reach question generation at all

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

## 3. `dpp-generate-questions` is deployed but exists in no branch

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

## 8b. Two deployed edge functions nothing calls — make that four

**Status:** Still not acted on, and the count has gone up. Two more uncalled
deployed functions surfaced on 2026-09-07 while recovering their source
(issue 3):

- `ai-expand-questions` (v6, ACTIVE) — nothing in `src` invokes it. It writes
  `question_templates` with `template_type='ai_mcq'`, the legacy Class 12 path,
  and hardcodes "Class 12" throughout its prompt. Unlike the OTP pair it is
  `verify_jwt = true` and staff-gated, so it is not an open endpoint — but its
  snapshot of `requireRole.ts` predates the has_role fix, so the gate almost
  certainly refuses everyone anyway.
- `mcp` (v5, ACTIVE) — nothing invokes it, its generator is absent from this
  repo, and its OAuth issuer names a different Supabase project. Its seven tools
  are read-only and route through the caller's own token, so they inherit RLS.

Both now have source and a README, which is the prerequisite for deciding
anything about them. The decision itself is still open, for the same reason as
the OTP pair: deleting a deployed function is irreversible from this repo.

The original two follow.

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

## 9b. Two shared modules drift across 7 AI functions each — found 2026-09-06, not fixed

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

## 11. `QuestionBankService.insert` sends a `school_id` that does not exist — found 2026-09-06

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

## 12. Contributed questions are student-visible immediately — `is_approved` defaults to `true`

**RULED AND APPLIED by `20260907000000`; the title above is now stale.** Measured
live 2026-09-07: `question_bank.is_approved` **defaults to `false`**, and
`buildQuestionBankInsertPayload` no longer forces it true — a test asserts the
key is absent from the payload so the column default is what decides.

**The consequence this entry predicted is now the live state, and it is issue
15's, not this one's:** with no approval mechanism anywhere, a teacher's
contribution reaches no student at all. Staff still read their own through
`qb_staff_read`, which ignores `is_approved`, so nothing is lost — it is
parked. The 21,696 seeded questions were not touched and remain approved.

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

## 13. `match_question_bank`'s body cites §4.2a for a rule that lives in §10.9

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

## 14. `dpp-generate-questions` reserves AI budget it never releases on failure

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

## 19. `MarksService.removeExam` has no UI caller — an exam is uncreatable-then-undeletable

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

## 20. Navigating away while marks save bounces the teacher back

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

## 21. `students_read` has the same self-referential shape `exams_read` had

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

## 22. Both exam event emitters swallow their own failure

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

## 24. Service class names are rendered to parents as UI labels

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

## 25. An admin can never correct submitted attendance — a stale audit trigger

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
