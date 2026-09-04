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

Whether students may trigger AI question generation — and so spend school AI
budget — is a policy question, not a build decision. **Needs a ruling.**

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

§10.11 states no read rule at all — it constrains who uploads, not who reads —
so this is unspecified rather than a violated requirement. Left alone because
the build brief said not to change any policy, and narrowing the read is a
separate decision. **Needs a ruling** if class-confined reading was intended.

## 7. `academic-files` is a public bucket with no tenancy scoping

Uploaded resources land in `academic-files`, which the student library already
resolves through `publicAcademicFileUrl` — that pairing predates this session
and decided the bucket.

The bucket is `public = true`, its object path is `{auth.uid}/{ts}-{name}` with
no school segment, and its SELECT policy is bare `bucket_id = 'academic-files'`.
So any authenticated user of any school can list every object, and anyone at all
with the URL can download one without a session. `storage.objects` has no
RESTRICTIVE tenancy fence, unlike the `public` schema tables.

Not changed here: the brief scoped this item to UI and service layer and
forbade policy changes, and moving the bucket would break the existing student
read path. Worth a ruling on whether school material belongs in a public bucket.

## 8. A deleted class strands its resources permanently

`learning_resources.class_id` is nullable and its FK is `ON DELETE SET NULL`,
but every write policy requires `class_id IS NOT NULL`. Deleting a class
therefore leaves its resources readable school-wide (if `is_published`) and
editable and deletable by nobody — not even the uploader.

## 9. `ownership.ts` disagreed with the database about who owns resources

`owners: ["admin", "principal", "teacher"]` against §10.11's "Uploaded by
teachers only — not admin, not principal" and against the live policies, which
require `has_role(auth.uid(),'teacher')` on all three write paths. probe4
already measured admin being refused.

**Fixed in this session** (narrowed to `["teacher"]`) because the new
`ResourceService.create`/`remove` guard through it and would otherwise have
promised a write the database refuses. Recorded here because it is the same
two-homes shape as the rest of this list.
