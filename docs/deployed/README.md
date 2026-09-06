# What is actually deployed

Source for code running in production that is **not** the same as the repo's
copy. Rule 26 (production is the source of truth until a hash says otherwise)
and rule 32 (a deploy whose source is unpushed is the same defect as a deploy
whose source was never committed).

Nothing here is bundled. These files sit outside `supabase/functions/` on
purpose — a stray `.ts` inside a function directory would be uploaded by the
next deploy of that function.

## `ai-gateway.index.ts`

Deployed 2026-09-08. **Production's own bytes plus one fix**, and nothing else.

The repo's `supabase/functions/ai-gateway/index.ts` is NOT this file and was
deliberately not touched: it carries 49 undispositioned drift hunks whose
reconciliation is a separate, deferrable job. Overwriting it with this would
have destroyed repo-side work that has never been deployed.

So the deploy started from `supabase functions download ai-gateway` and edited
those bytes directly. `_shared` was verified byte-identical to production before
and after the edit (downloaded twice, diffed), so **none of the other 48 hunks
shipped**.

### The one change

`resolveActor()` determined the caller's role with a `has_role()` loop issued
through the **service-role** client. `has_role/2` branches on `auth.uid()`; a
service-role client carries no user JWT, so `auth.uid()` is NULL, the
cross-account branch is taken, and it compares `m.school_id = get_my_school_id()`
— also NULL. `NULL = NULL` is never true, so every role answered false,
`resolveActor` returned null for everyone, and the gateway replied
`403 actor_unresolved` to all six student surfaces it gates: practice, revision,
analysis, recovery, doubts and the AI coach. `ai_request_decisions` recorded
nothing from 2026-08-25.

This is KNOWN_ISSUES 1 in a second place — the same defect `_shared/requireRole.ts`
had, which was fixed for that module but never here.

It now reads `memberships` directly. service_role bypasses RLS, so no session is
needed, and it asks the question `has_role` was being used to ask. Order mirrors
`ROLE_PRIORITY` in `src/auth/session.ts` minus `super_admin`, which `memberships`
forbids by `CHECK (role <> 'super_admin')`. A `user_roles` fallback matches
`session.ts` so accounts predating the memberships migration are not locked out.

### Verified after deploying

A real student session (`kabir.khan@wisdomcampus.com`) against
`POST /functions/v1/ai-gateway`:

- before: `403 {"error_code":"actor_unresolved"}`
- after: `400 invalid_envelope` on a malformed body — past `resolveActor`
- after, well-formed: **HTTP 200**, `decision: answered_deterministic`, with the
  correct `studentId` and `schoolId` resolved, `used_model: false`
- `ai_request_decisions` recorded a row for the first time since 2026-08-25

`check:edge-drift` still reports `ai-gateway/index.ts` as drifted, with a new
production hash. That is correct and expected: the repo copy and the deployed
copy genuinely differ, and that is the 49-hunk reconciliation, still open.
**Do not baseline it.**
