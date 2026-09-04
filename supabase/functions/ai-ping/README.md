# ai-ping

`index.ts` here is a copy of **deployed version 10** (ACTIVE, `verify_jwt = true`),
recovered on 2026-09-04. Like `dpp-generate-questions`, this function was live
with its source on no branch.

## It is currently broken for everyone

`ai-ping` gates on `requireAnyRole(req, ["admin", "principal"])` — the same
helper, and therefore the same defect, as `dpp-generate-questions`:

`requireAnyRole` asks `has_role` through a **service-role** client. `has_role`
branches on `auth.uid()`, which is NULL there, so it takes the branch comparing
`m.school_id = get_my_school_id()` — also NULL — and answers `false` for every
role. Measured: `has_role(admin,'admin')` with no JWT is `false`, and `true`
with that admin's own JWT.

So `npm run ai:ping`, the connectivity check for the whole AI path, cannot pass
for a real admin or principal. **This is the second confirmed casualty of
KNOWN_ISSUES 1, which makes it a shared-helper defect rather than a
one-function problem.** Any deployed function using `requireAnyRole` is closed
to everybody.

## How to recover a deployed function's source

Use the MCP `get_edge_function` tool and take `files[].content` — that is the
pristine source as deployed.

**Do not use the Management API `GET /v1/projects/{ref}/functions/{slug}/body`
for this.** It returns an eszip archive whose embedded sources are
**transpiled**, not original: array literals are re-wrapped across lines, the
`*/ import` after a doc comment is joined onto one line, and formatting is
normalised throughout. It is fine for confirming that an identifier or string
is present, and useless for reproducing a file byte-for-byte. A copy recovered
from it would look authoritative and be subtly wrong.

## Still unrecovered

`ai-expand-questions` and `mcp` are deployed and exist in no branch. Recover
them the same way — MCP `get_edge_function`, take `files[].content`, write it
out programmatically rather than retyping it.

Before deploying anything from this directory, check the `_shared` drift
recorded in `../dpp-generate-questions/README.md`; those modules are shared.
