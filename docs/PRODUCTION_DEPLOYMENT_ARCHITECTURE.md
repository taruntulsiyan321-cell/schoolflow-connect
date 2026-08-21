# Production Deployment Architecture

**Written:** 2026-08-06, following the deployment-drift investigation in `docs/MIGRATION_STATE_2026-08-06.md` and `docs/DEPLOYMENT_RUNBOOK.md`. This document answers a different question than those two: not "what's broken right now," but **"what is this project's deployment architecture actually supposed to be, and what does it take to make that true permanently."**

Investigation only — nothing in this document has been implemented.

---

## TL;DR

Three independent systems (frontend hosting, database migrations, edge functions) each have a *plausible intended* automated path, and each one is broken in a different way — but none of them are broken because the automation is hard. They're broken because a single setup step (one GitHub secret) was never completed, and because deployment history for this project turns out to be a mix of automated intent and manual, untracked interventions that were never reconciled. There's also a fourth system nobody asked about: a second, forgotten, half-broken deployment on Vercel, sitting on the same GitHub repo.

The permanent fix is small: one GitHub secret, one new workflow file, one hosting-platform dashboard check, and a decision about the Vercel deployment. None of it requires new infrastructure.

---

## 1. How is the frontend supposed to reach production?

**Evidence found (at the time of this investigation — the low-code scaffolding tooling referenced below has since been fully removed from this repo):**
- An auto-generated manifest file and `vite.config.ts`'s `mcpPlugin()` / `componentTagger()` (from a low-code app-builder platform's dev-tooling packages) confirmed this was a platform-managed project, not a plain Vite app with the platform used once for scaffolding.
- The live site tested throughout this investigation was hosted on that platform's own hosting domain.
- No `vercel.json`, no Vercel references in `package.json`, no Vercel deploy script anywhere in the repo — yet `gh repo view` reports the repo's GitHub homepage URL as `https://schoolflow-connect.vercel.app`, and that URL is **live** (HTTP 200, `Server: Vercel`), serving what appears to be the same app.
- `gh api repos/.../hooks` returns `[]` — **zero classic webhooks are registered on this repo.** Vercel's GitHub integration doesn't need one (it uses a GitHub App instead), which is consistent with Vercel silently auto-deploying on every push without ever showing up as repo config.
- The Vercel deployment's client-side routing is broken — `/auth` returns Vercel's own `404: NOT_FOUND` on direct navigation, because there's no SPA rewrite rule. That's the standard symptom of a zero-config Vercel import that auto-deploys but was never actually finished.

**Conclusion:** there were **two** frontend deployment paths live at the time, and neither was confirmed to be the one anyone actually used:

1. **The low-code platform's own hosting** — presumed to auto-rebuild on GitHub push (that platform's standard behavior when GitHub Sync is connected), but **this was not observed to happen**: the bundle hash didn't change in the 8 minutes after this session's push landed. Either the rebuild takes longer than that, or GitHub sync wasn't actually enabled for this project. This has since been made moot — all platform-specific build tooling has been removed from the repo, so it's no longer a candidate deployment path.
2. **A Vercel deployment** (`schoolflow-connect.vercel.app`) — almost certainly auto-deploying via Vercel's GitHub App on every push (no manual trigger visible anywhere in the repo), but shipped with broken SPA routing and, as far as this investigation found, never used for QA, testing, or referenced anywhere except the repo's own GitHub metadata.

Neither was "the answer" with full confidence from repo evidence alone. What *is* certain: whoever set up Vercel did so outside this repo's tracked config, and nobody has maintained it since. With the low-code platform's tooling now removed, **Vercel (or another plain-Vite host chosen going forward) is the only remaining frontend deployment path** — it needs the SPA rewrite fix before it's production-ready.

## 2. How are database migrations intended to reach production?

**Evidence found:**
- `package.json` defines `db:migrate`, `db:migrate:all`, and `db:check-migrations`, backed by `scripts/apply-pending-migrations.mjs` and `scripts/check-pending-migrations.mjs`.
- Both scripts accept **either** `SUPABASE_ACCESS_TOKEN` (Management API) **or** `DATABASE_URL` (direct Postgres), read from `.env.local` (gitignored via the `*.local` pattern) or the process environment.
- No GitHub Actions workflow runs these scripts. `.github/workflows/` contains only `quality.yml` (lint/test on every push) and `deploy-edge-functions.yml` (functions only, see §3). **There is no CI path for migrations at all.**
- 45 files in `docs/APPLY_*.sql` — a parallel, manual convention: extract a migration's SQL into a standalone file for a human to paste into the Supabase SQL editor. `docs/KNOWN_ISSUES.md` documents at least one case (`rpc_academic_revision_plan`) where a migration existed in history but was never applied live — the exact failure class this session found twice more.

**Conclusion:** the *tooled* intended path is `npm run db:migrate` — run locally or in CI, by a human or a pipeline, whenever there's a credential available. It has never been wired into CI. The `docs/APPLY_*.sql` convention exists specifically to route around this gap by hand. There is no automated migration deployment today, full stop — only a script that works once you give it a credential.

## 3. How are Edge Functions intended to reach production?

**Evidence found:**
- `.github/workflows/deploy-edge-functions.yml` — triggers on push to `main` when `supabase/functions/**`, `supabase/config.toml`, or the workflow file itself changes (or via manual `workflow_dispatch`). Deploys a fixed list of 11 functions using `SUPABASE_ACCESS_TOKEN` from repo secrets.
- `gh secret list` — empty. The secret this workflow requires has never existed.
- `gh run list` — this workflow has **never executed**, not once, in the visible run history (only `Quality gates` runs appear).
- `supabase/config.toml` declares only 10 of the 18 function directories that actually exist in `supabase/functions/`.
- Yet **16 of 18 functions are confirmed live in production** (per the earlier QA sweep) — including several never declared in `config.toml` and never included in the GitHub Actions FUNCS list (`admin-link-account`, `ai-expand-questions`, `send-push`) and one (`mcp`) that was regenerated by the low-code platform's own Vite plugin on every dev-server start and deployed through a completely separate, platform-internal path. That function and its generator have since been removed from the repo entirely.

**Conclusion:** almost every function that's live today got there through **manual, untracked `supabase functions deploy` calls** — someone with a working Supabase CLI session ran them by hand, at various points, outside of any process this repo records. The GitHub Actions workflow is aspirational infrastructure that has never actually deployed anything. `ai-gateway` is missing specifically because whoever did those manual deploys never got to it (it's the most recently *written* function to be wired into the FUNCS list, alongside the whole coach-agent AI framework — plausibly the newest addition, added to the workflow file before ever being deployed by any means).

## 4. Why is the current process broken?

Four independent, compounding causes — not one root cause:

1. **A single missing GitHub secret** (`SUPABASE_ACCESS_TOKEN`) blocks the one piece of real CI automation that exists (edge functions), and also blocks every local/manual credentialed path (`db:migrate`, `functions:deploy-gateway`) unless someone happens to have it in their own `.env.local`.
2. **Migrations were never wired into CI at all** — not broken, just never built. The `docs/APPLY_*.sql` convention is the human's workaround for a gap that automation never filled.
3. **Deployment history is a mix of automated intent and manual reality that were never reconciled** — `config.toml` doesn't list every deployed function, the GitHub Actions FUNCS list doesn't match what's actually live, and most of what's live got there by hand. Nobody can currently look at this repo and know, with certainty, "what would redeploying from scratch actually produce."
4. **There were two competing frontend targets** (the now-removed low-code platform + an apparently-forgotten Vercel import), and it wasn't confirmed from repo evidence which one — if either — auto-deployed reliably. With the platform's tooling removed, Vercel (or a newly chosen host) is now the only candidate.

None of these are hard engineering problems. They're the accumulated result of manual, ad hoc deploys substituting for automation that was scaffolded but never finished or wired end-to-end.

## 5. Smallest permanent fix — one-click deployment

Ordered by leverage (highest impact first):

1. **Add the `SUPABASE_ACCESS_TOKEN` GitHub secret.** This alone unblocks edge-function CI and every local script. Nothing else in this list matters until this exists.
2. **Add a migrations workflow**, mirroring `deploy-edge-functions.yml`: triggers on push to `main` when `supabase/migrations/**` changes, runs `npm run db:migrate` with the same secret. This is the one missing piece of automation — everything needed to build it already exists (`scripts/apply-pending-migrations.mjs`).
3. **Reconcile `supabase/config.toml`** to declare all 18 (or however many are actually meant to ship) function directories, and reconcile the GitHub Actions FUNCS list against the real, current directory listing — not the historical list someone wrote by hand. This makes "what should be deployed" a fact you can read off the repo instead of something you have to reverse-engineer from what happens to be live.
4. ~~Confirm GitHub auto-deploy is enabled on the low-code platform's dashboard.~~ Moot — that platform's tooling has been fully removed from this repo; it's no longer a deployment target.
5. **Decide what to do with the Vercel deployment** (§6 below) before it causes confusion about which URL is "real."

Once 1–3 exist, **the full deployment sequence becomes: `git push origin main`.** Frontend, migrations, and functions all react to the same push automatically. That's the one-click target — it doesn't require new infrastructure, just finishing what's already scaffolded.

## 6. `APPLY_*.sql` convention — keep it, but change what it's *for*

The 45 `docs/APPLY_*.sql` files are not a broken process to be replaced wholesale — they're a **correct, defensive workaround for a gap that's about to close.** Once migrations have real CI automation (§5.2), most of the reason for this convention disappears: routine, idempotent, `IF NOT EXISTS`-guarded migrations don't need a human to hand-carry them into the SQL editor anymore.

But at least one of the files this session touched directly argues for keeping the convention alive in a narrower role: `docs/APPLY_DOUBT_REMAP_LOGINABLE_TEACHERS.sql` corresponds to a migration with **zero idempotency guards and bare `UPDATE`/data-remapping statements** (see `docs/MIGRATION_STATE_2026-08-06.md` §5). That kind of change — a one-time data correction, not a repeatable schema change — is exactly the kind of thing that *should* require a human to read it and consciously decide to run it once. Automating that away would trade a slow, deliberate safety mechanism for a fast, silent one, on precisely the migrations where "silent and fast" is the wrong property to have.

**Recommendation:** narrow the convention going forward, don't retire it.
- Ordinary schema migrations (new tables, new columns, new functions with `CREATE OR REPLACE`) → automated CI path, no `APPLY_*.sql` needed.
- One-time data remaps, backfills, or anything with a bare `INSERT`/`UPDATE`/`DELETE` and no `IF NOT EXISTS`/`ON CONFLICT` guard → keep extracting to `docs/APPLY_*.sql` for deliberate, reviewed, manual execution — that's the convention doing exactly what it should.

## Exact one-time setup required

- [ ] **Generate a Supabase Personal Access Token** — `supabase.com/dashboard/account/tokens` (requires your Supabase account login; not something this environment can do).
- [ ] **Add it as a GitHub repo secret** named exactly `SUPABASE_ACCESS_TOKEN` — `github.com/taruntulsiyan321-cell/schoolflow-connect/settings/secrets/actions`.
- [x] ~~Check the low-code platform's project dashboard for GitHub Sync.~~ No longer applicable — that platform's tooling and hosting have been dropped as a deployment target for this project. If a project still exists on that platform's own dashboard, it should be deleted/unlinked there directly (outside this repo's control).
- [ ] **Decide on the Vercel deployment** — either add a minimal `vercel.json` SPA rewrite so it's not broken, or disconnect the GitHub integration from Vercel's own dashboard so it stops silently auto-deploying a URL nobody's testing against. Either is fine; leaving it as-is (live, broken routing, untested, competing for the "which URL is real" question) is the one option that isn't.
- [ ] **Add the migrations GitHub Actions workflow** (§5.2) — this is implementation, not setup, and belongs in a follow-up change once the above exists, not this document.

Once the checked items above are done, `docs/DEPLOYMENT_RUNBOOK.md`'s sequence executes exactly as written, and every deployment after that is a single `git push`.
