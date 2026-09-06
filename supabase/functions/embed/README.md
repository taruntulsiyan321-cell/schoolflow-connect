# `embed`

Turns one query string into one embedding vector. That is the whole function.

## Provenance

**Written in this repo on 2026-09-06 and committed before it was ever
deployed.** It is the first edge function in this project with that property —
every other one was recovered from production after the fact (rule 26), and two
of the seventeen deployed slugs still have no source on any branch. There is no
"deployed version N" to reconcile against here: the repo is the origin.

Consequence for `npm run check:edge-drift`: this function must read **zero
drift** from its first deploy onward. If it ever drifts, something was deployed
from outside the repo, and that is the only thing it can mean.

## Why it exists

`match_question_bank(p_query_embedding vector, ...)` takes a **pre-computed
vector**. A browser cannot produce one — the embedding key is a server secret,
and `_shared/embeddingProvider.ts` was bundled only by `ai-gateway`. That is
what blocked MCQ retrieval, and it is all this function unblocks.

## Why it is not a mode on something that already exists

- **Not a mode on `dpp-generate-questions`.** That function's README states it
  is byte-for-byte deployed v12. Adding an embed mode changes its bundle and
  quietly makes that claim false.
- **Not a slice of `ai-gateway`.** ai-gateway carries 49 undispositioned hunks
  and is frozen.

Embedding is shared infrastructure — retrieval, duplicate detection and any
future search all need it — so it earns its own function rather than a flag on
somebody else's.

## What it bundles, and what it refuses to bundle

| module | why |
|---|---|
| `_shared/embeddingProvider.ts` | the point of the function. **Zero imports of its own.** |
| `_shared/requireRole.ts` → `_shared/requireAuth.ts` | the standard auth posture |

It deliberately does **not** import `_shared/structuredCompletion.ts` for
`corsHeaders` / `jsonResponse`. That module is drifted against production
(repo `d5fb667140a7` / prod `d0fd90b22cb8`), and importing it to save eight
lines would ship known drift into a function whose whole selling point is that
it has none. Both helpers are inlined instead.

`embeddingProvider.ts` was confirmed **byte-identical to the deployed copy**
before being bundled (2026-09-06): downloaded from `ai-gateway`'s deployment
and compared with newlines normalised, the way `check:edge-drift` hashes. The
raw bytes differ by exactly 291 — one CR per line — and nothing else.

Verifying that mattered: the module is absent from the drift report, and
"absent from the report" is not evidence of being undrifted. The gate only
compares a `_shared` module **if some deployed function imports it**, so a
module nothing deploys would look equally clean. It had to be checked
positively.

## Contract

```
POST /functions/v1/embed
Authorization: Bearer <user JWT>
{ "text": "photosynthesis light reaction" }     // "query" also accepted
```

```jsonc
200 { "ok": true, "embedding": [...], "dims": 1536, "model": "...", "provider": "openrouter" }
400 { "error": "Provide `text` to embed" }      // or a non-JSON body
401 / 403                                        // from requireAnyRole
403 { "error": "No school context for caller" }
429 { "error": "Daily AI budget ...", "error_code": "budget_exhausted" }
502 { "error": "embedding_provider_unset", "error_code": "embedding_failed" }
503 { "error": "Could not check the AI budget", "error_code": "budget_check_failed" }
```

**It never fakes a vector.** No zero vector, no random vector, no silent
success. A caller that gets no embedding is expected to fall through to lexical
retrieval, exactly as when none is supplied.

**429 and 503 are different answers.** A budget that could not be *read* is not
a budget that was *exceeded*; reporting the first as the second sends a teacher
to look at the wrong thing. `dpp-generate-questions` currently conflates them
(`budgetErr || !budgetRow || ok === false` → one 429) — that is recorded in
`KNOWN_ISSUES.md`, and this function does not repeat it.

## Roles

`teacher`, `admin`, `principal` — the same list as `dpp-generate-questions`.

Students are **not** admitted. KNOWN_ISSUES 2 rules that students should reach
question *generation*; that ruling is about generation, and widening this gate
is a separate decision rather than one to take in passing.

## Cost

An embedding is a paid provider call, so it is metered like one: 1 unit against
`staff.embed.query` (generation reserves 2 against
`teacher.dpp.generate_questions`). Its own `feature_id` keeps the two separable
in `ai_budget_usage`. An unconfigured `feature_id` falls back to the school's
daily quota (200 soft / 400 hard) rather than failing, so nothing needs seeding
before first use.

Metering was added deliberately, slightly beyond "return an embedding and
nothing else": an unmetered paid endpoint reachable by any teacher is a cost
hole, and the reservation costs ten lines and no extra bundled module —
`createClient` is already pulled in by `requireRole.ts`.

## Not verified

`OPENROUTER_API_KEY` is not available locally, so **no live embedding call has
been made through this function**. What is verified: it typechecks, it deploys,
it reads zero drift, and its auth and budget paths are the same ones already
exercised elsewhere. The provider round-trip itself is unproven here.
