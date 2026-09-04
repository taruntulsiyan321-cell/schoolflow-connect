# dpp-generate-questions

`index.ts` here is a **faithful copy of deployed version 12** (ACTIVE,
`verify_jwt = true`, pushed 2026-08-20T06:48:55Z), pulled back from the project
on 2026-09-04. It is byte-for-byte what production runs; nothing was edited on
the way in.

## Why it had to be recovered

The source was deleted in `7f9142b` ("Repurpose the DPP generator into the
recovery variant generator", 2026-08-30) on the stated grounds that the
function "had zero callers left". The live version had been pushed **ten days
earlier** and was never redeployed or removed, so production kept running code
that existed on no branch, while `supabase/config.toml` still declared
`[functions.dpp-generate-questions]` for a directory that was gone.

The premise has since changed: it has two callers again.
`src/pages/shared/QuestionBankPage.tsx` and `src/lib/aiPracticeQuestions.ts`
were invoking `test-generate-questions`, a slug deployed nowhere and present on
no branch, and were repointed here because this function's request and response
contract matches theirs exactly.

`ai-recovery-variants` is the *successor*, not this function. It shares the
lineage and nothing else: service-role only, `{source_question_id, tier}` in,
and it writes `question_bank`.

## Do not deploy this directory without reading this first

Two of the eight `_shared` modules this function bundles have drifted since
version 12 was pushed:

| module | deployed | repo |
|---|---|---|
| `_shared/structuredCompletion.ts` | `932502c04d15` | `c38b0467f8cd` |
| `_shared/promptLibrary.ts` | `b71b6fcfa3a4` | `75075959e0ef` |

(sha256 of the newline-normalised contents, first 12 hex chars.)

The other six — `modelRouter`, `reasoningBudget`, `failureRecovery`,
`promptEvaluation`, `requireRole`, `requireAuth` — are identical.

So `supabase functions deploy dpp-generate-questions` from this repo would
**not** reproduce production: it would ship those two changed modules too.
Diff them and decide deliberately before deploying.

## Known defect: it currently refuses everyone

It gates on `requireAnyRole(req, ["teacher","admin","principal"])`, which asks
`has_role` through a **service-role** client. `has_role` branches on
`auth.uid()`; there is no user session on that client, so it takes the branch
that compares `m.school_id = get_my_school_id()` — also NULL — and answers
`false` for every role.

Confirmed over real HTTP with a genuine teacher's access token (Priya Sharma,
who holds an active `teacher` membership in the right school):

```
POST /functions/v1/dpp-generate-questions
  -> 403 {"error":"Forbidden","error_code":"insufficient_role"}
```

`_shared/requireRole.ts` is identical here and in production, so the local copy
is the code responsible. See KNOWN_ISSUES 1 for the two candidate fixes — one
in `has_role` (no redeploy, fixes every caller at once) and one here (needs a
redeploy, and therefore needs the `_shared` drift above resolved first).
