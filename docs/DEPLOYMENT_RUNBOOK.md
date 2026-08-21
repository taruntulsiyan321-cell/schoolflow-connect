# Deployment Runbook — Production Synchronization

**Purpose:** bring production (frontend + database + edge functions) up to date with the current repository state in one controlled window. Written 2026-08-06, blocked on `SUPABASE_ACCESS_TOKEN` at every database/function step — see prerequisites.

**Do not start this runbook until the prerequisite is satisfied.**

## Prerequisite

A Supabase Personal Access Token, generated at `supabase.com/dashboard/account/tokens`, added as a GitHub repo secret named exactly `SUPABASE_ACCESS_TOKEN`. This single credential unlocks steps 2 and 3 below — the edge-function GitHub Actions workflow and the local migration-apply script both read it by that exact name.

Separately, confirm whichever frontend host is live (Vercel or otherwise — see `docs/PRODUCTION_DEPLOYMENT_ARCHITECTURE.md`) has GitHub-push auto-deploy actually enabled. If it does, step 1 may already be resolved by the time this runbook runs (the 10 commits were pushed on 2026-08-06; re-check the live bundle hash before starting).

---

## 1. Frontend deployment

**Goal:** production serves the current `main` HEAD.

1. Confirm `git status` shows `main` is not ahead of `origin/main` (it shouldn't be — already pushed as of `fb973a3`). If it is ahead again by the time this runs, push first.
2. Check the live bundle hash:
   ```bash
   curl -s "https://<live-frontend-host>/" | grep -oE 'src="/assets/index-[^"]*\.js"'
   ```
   Compare against the hash in a fresh local build (`npm run build`, check `dist/index.html`). If they already match, this step is done — skip to §2.
3. If they don't match, trigger a redeploy through whatever mechanism the host exposes (Vercel dashboard "Redeploy," or re-checking its GitHub integration). This step cannot be completed from this environment — it needs access to that host's dashboard.
4. Re-check the bundle hash after triggering. Do not proceed to verification (§4) until it changes.

## 2. Database migrations

**Goal:** the two confirmed-missing migrations land; the duplicate-timestamp collisions are resolved first.

1. **Rename the three colliding migration files** (see `docs/MIGRATION_STATE_2026-08-06.md` §5 for the full rationale):
   ```bash
   git mv supabase/migrations/20260802240000_universal_question_attempt_intelligence.sql \
          supabase/migrations/20260802240500_universal_question_attempt_intelligence.sql
   git mv supabase/migrations/20260803200000_doubt_remap_loginable_teachers.sql \
          supabase/migrations/20260803210000_doubt_remap_loginable_teachers.sql
   git mv supabase/migrations/20260803400000_auth_signup_no_default_school.sql \
          supabase/migrations/20260803450000_auth_signup_no_default_school.sql
   ```
   Commit this rename on its own — do not bundle it with anything else.
2. **Before rerunning anything**, read `doubt_remap_loginable_teachers.sql` in full — it has zero idempotency guards (see audit doc §5). Confirm by hand whether its effect has already landed (spot-check whatever it updates) before deciding whether it needs to run again.
3. Apply the two confirmed-missing migrations:
   ```bash
   SUPABASE_ACCESS_TOKEN=<token> npm run db:migrate
   ```
   This runs every migration filename `>= 20260509000000` (per `scripts/apply-pending-migrations.mjs`'s `RECENT_SINCE` cutoff) — which safely covers both confirmed gaps. Every statement in both files uses `ADD COLUMN IF NOT EXISTS`, so this is a no-op everywhet already applied and additive everywhere it isn't.
4. Immediately re-check with the read-only probe:
   ```bash
   SUPABASE_ACCESS_TOKEN=<token> npm run db:check-migrations
   ```

## 3. Edge Function deployment

**Goal:** `ai-gateway` (and `ai-ping`, also currently undeployed but unused by the frontend) go live.

1. Trigger the existing GitHub Actions workflow — it deploys the full AI function set, `ai-gateway` included, in one pass:
   ```bash
   gh workflow run deploy-edge-functions.yml
   ```
   Or, to deploy just the gateway locally without waiting on CI:
   ```bash
   SUPABASE_ACCESS_TOKEN=<token> npm run functions:deploy-gateway
   ```
2. Confirm the workflow run succeeds:
   ```bash
   gh run list --workflow=deploy-edge-functions.yml --limit 1
   ```

## 4. Verification checklist

Run in order; each depends on the previous step having actually landed.

- [ ] **Frontend:** live bundle hash matches a fresh local build's hash.
- [ ] **Mistake Book:** QA account (`qa.automation@wisdomcampus.com`) shows 42 mistakes on the live site, matching the fresh-local-build count from the original QA sweep — not 0.
- [ ] **Homework page:** loads without the `column homework.work_kind does not exist` error.
- [ ] **Notices page:** loads without the `column notices.published_at does not exist` error.
- [ ] **`ai-gateway`:** direct check returns something other than 404:
  ```bash
  curl -X OPTIONS https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/ai-gateway
  ```
- [ ] **Nova end-to-end:** ask a real question in AI Coach on the live site; confirm an actual answer, not "Learning service unavailable."
- [ ] **Full student-panel re-audit:** rerun the original sweep (all ~21 previously-verified pages) against production, not a local build this time.

## 5. Rollback plan

**Frontend:** most hosted-platform deploys (Vercel included) are rollback-able from their own dashboard (redeploy a prior build) — this repo has no independent rollback mechanism for the frontend. If the new build breaks something the old one didn't, use the host's own rollback, not a git revert (a git revert only fixes the *next* deploy, not what's live right now).

**Migrations:** both confirmed-gap migrations are strictly additive (`ADD COLUMN IF NOT EXISTS`) — there is nothing to roll back; worst case they're a no-op. If `doubt_remap_loginable_teachers.sql` turns out to need rerunning and something looks wrong afterward, its effect is a data remap (teacher assignment on doubts) — fix forward with a corrective UPDATE rather than attempting a blind rollback, since there's no "before" snapshot captured by this process.

**Edge functions:** if `ai-gateway` deploys but misbehaves, `supabase functions delete ai-gateway --project-ref psqxykzqfvxgsvkmgurn` removes it, reverting to the current (broken but at least *known*) 404 state, which the frontend already handles as "service unavailable" rather than crashing.

**General rule for this window:** do not run any step whose verification you can't check immediately afterward. If §1 (frontend) can't be confirmed working, don't proceed to §2 — a schema change under a broken frontend build is harder to reason about than a schema change under one you know works.

---

## Sequence, once the token exists

Matches the order given in this deployment request exactly:

1. Deploy `ai-gateway` (§3)
2. Apply the confirmed-missing migrations (§2)
3. Verify migration success (§4)
4. Verify edge function deployment (§4)
5. Confirm production frontend is serving the latest build (§1 + §4)
6. Re-run the complete student-panel audit (§4, last item)
7. Produce one final report separating: fixed by frontend deployment / fixed by migrations / fixed by edge-function deployment / remaining genuine application bugs

Only after that report lands should Teacher Dashboard, Parent Dashboard, or any other new engineering work resume.
