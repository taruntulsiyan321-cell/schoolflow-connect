# dpp-generate-questions

## `index.ts` NO LONGER MATCHES deployed v12 — deliberately, as of 2026-09-06

This file used to say `index.ts` was a faithful byte-for-byte copy of deployed
version 12. **That claim is now false, and it was made false on purpose.** It is
recorded here rather than quietly dropped, because the parity claim is the only
reason anyone trusted this directory.

Three changes were made in one release. All three are additive: a caller that
sends the original body gets the original MCQ behaviour.

1. **A non-MCQ path.** `question_format` accepts `mcq` (default), `short` or
   `long`. The JSON schema and the prompt branch on it: non-MCQ questions carry
   an `answer` string instead of `options` / `correct_index`. §4.2a's "the
   correct answer must be generated with the question" applies to every format,
   not only the one that could encode the answer as an index. Token budget
   scales with the format — 180/question for MCQ as before, 300 for short, 700
   for long, because budgeting MCQ-sized tokens for a full model answer is what
   truncation looks like.

2. **The hardcoded board and class are gone.** The system prompt said
   *"expert CBSE Class 12 question setter"* on every call. The bank is **RBSE**
   across **8 class levels (6–12)**, so the generator was being asked for the
   wrong board and the wrong class on nearly every request — a correctness bug
   independent of the non-MCQ work, fixed here because the same prompt string
   carries both. The board is now read from the caller's school
   (`schools.board`); the class comes from an optional `class_level`. Neither is
   guessed: an unknown class becomes "the class level indicated by the subject
   and source material", because a wrong "Class 12" is worse than no class — it
   silently produces off-syllabus questions that look right.

3. **429 stops being the answer to every budget problem.** `budgetErr` (the
   reservation RPC itself failing) shared a branch with genuine exhaustion, so a
   database hiccup told the teacher to come back tomorrow. They are now 503
   `budget_check_failed` and 429 `budget_exhausted`, and the 429 carries
   `units_used` / `hard_limit`.

`ai-recovery-variants` remains the successor for the variant path; this
divergence does not change that.

### What is still true of the original recovery

The v12 source was pulled back from the project on 2026-09-04 and nothing was
edited on the way in. Everything above was applied on top of that verified
starting point, in this repo, with the diff in git.

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

## The `_shared` drift is RESOLVED — this section used to say otherwise

`structuredCompletion.ts` and `promptLibrary.ts` were drifted against v12 and
this file warned not to deploy because of them. **They shipped deliberately in
`035c99c` (2026-09-06)** along with the `requireRole.ts` has_role fix, and
`npm run check:edge-drift` now reports **no finding of any kind for this
function**. It is the one AI-adjacent function that is clean to deploy, which is
why this work was built on it rather than on `ai-gateway`.

Re-verified 2026-09-06 before the release above.

## Fixed: it used to refuse everyone

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

**FIXED 2026-09-06.** `_shared/requireRole.ts` now asks `has_role` **as the
caller** rather than through the service-role client, and shipped in `035c99c`.
The description below is kept because it is the clearest statement of what the
defect was; it is history, not current behaviour.

## Contract

```jsonc
POST /functions/v1/dpp-generate-questions
{
  "subject": "Accountancy",       // as before
  "chapter": "Accounting Ratios", // as before
  "topic": "current ratio",       // as before
  "difficulty": "medium",         // as before
  "count": 5,                     // as before, clamped 1..20
  "source_text": "", "source_url": "",

  "question_format": "mcq",       // NEW, optional: mcq (default) | short | long
  "class_level": 10               // NEW, optional: 6..12; omitted = not asserted
}
```

MCQ response is unchanged except that each question now carries
`question_format`. Short and long answer return `answer` in place of `options`
and `correct_index`:

```jsonc
{ "questions": [ { "question": "...", "answer": "...", "explanation": "...",
                   "question_format": "short" } ],
  "source": "openrouter_nemotron", "question_format": "short",
  "board": "rbse", "class_level": 10 }
```

**`topic` is never returned as a generated value.** Rule 31: generated questions
carry `chapter` and leave `topic` NULL, never a guessed topic string.

## Not verified

`OPENROUTER_API_KEY` is not available in this environment, so **no live
generation has been run through the non-MCQ path.** What is verified: it
typechecks, it deploys, and it reads zero drift. The model's actual adherence to
the short/long schema is unproven, and the first live run should be `count = 1`.
