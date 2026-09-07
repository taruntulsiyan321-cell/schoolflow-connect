# ai-expand-questions

## Recovered from production 2026-09-07 — deployed v6, byte-for-byte

`index.ts` here is the exact source of deployed version 6, pulled back with the
MCP `get_edge_function` tool and written without editing a character
(sha256 prefix `a60d6181dd22`, 5,525 bytes). It was one of two slugs
`npm run check:edge-drift` reported as **NO-REPO-SOURCE — deployed, and on no
branch**. Production now has a home in git.

Do **not** recover a function from the Management API's
`GET /v1/projects/{ref}/functions/{slug}/body`. That returns an eszip whose
embedded sources are transpiled — array literals re-wrapped, comment/import
lines joined, formatting normalised — so a copy taken from it looks
authoritative and is subtly wrong. `get_edge_function`'s `files[].content` is
the pristine source. (KNOWN_ISSUES 3 records the byte-comparison that proved it.)

## Five of its eight `_shared` snapshots have drifted

A deployed function carries its own frozen copy of every `_shared` module it
imports, so recovering `index.ts` does not make a deploy from this repo
reproduce production. `npm run check:edge-drift` — which normalises newlines
before hashing, so CRLF is never reported as drift — measured this at recovery,
repo against production:

| module | repo | prod (v6) |
|---|---|---|
| `modelRouter.ts` | `2cd4c73acfbd` | `2273dd3d509c` |
| `promptLibrary.ts` | `4a28b47c6d34` | `5817de4bf288` |
| `reasoningBudget.ts` | `fb5369f99b16` | `3e2d4c35d6e6` |
| `requireRole.ts` | `d636f71af7fa` | `a45dfe4956a0` |
| `structuredCompletion.ts` | `d5fb667140a7` | `d0fd90b22cb8` |

`failureRecovery.ts`, `promptEvaluation.ts` and `requireAuth.ts` match.

(An earlier draft of this file listed all eight as differing, from hashes taken
without newline normalisation. The gate's numbers above are the ones to trust;
three of those eight differed only in line endings.)

`requireRole.ts` is the one that matters most: this deployment predates the
has_role fix, so its role gate asks `has_role` through the service-role client
and answers `false` for every caller — the same defect KNOWN_ISSUES 1 describes.
This function is therefore almost certainly refusing everyone right now. It has
no caller, so nothing notices.

A redeploy from here would fix that gate and simultaneously replace five modules
with newer ones the function has never run against. That is a deliberate act,
not a formality. Nobody should do it as a side effect of touching this
directory.

## It has no caller

Nothing in `src` invokes `ai-expand-questions`, the same way nothing invokes
`send-otp` or `verify-otp` (KNOWN_ISSUES 8b). It writes
`public.question_templates` with `template_type = 'ai_mcq'`, the legacy Class 12
path, and hardcodes "Class 12" throughout its prompt — the same hardcoding that
was removed from `dpp-generate-questions` because the bank is RBSE across
classes 6–12.

Recovered rather than deleted: deleting a deployed function is irreversible from
this repo, and a function whose source exists can at least be read before that
decision is made. The decision itself is still open.
