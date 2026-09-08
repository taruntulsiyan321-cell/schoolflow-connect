-- ═══════════════════════════════════════════════════════════════════════════
-- Retire abandoned auth sessions left behind by the evidence suite
--
-- MAINTENANCE, NOT A MIGRATION. It changes no schema and is safe to run again;
-- apply it with `--no-ledger`.
--
-- ── READ THIS BEFORE RUNNING IT ──────────────────────────────────────────
--
-- THE FIRST VERSION OF THIS FILE PUT ITS SAFETY CHECK AFTER `COMMIT;`.
--
-- The check was a positive control — "if EVERY session was deleted, abort" —
-- and it was correct about what to look for. It could not act on it. An
-- explicit COMMIT had already ended the transaction, so the DO block ran in a
-- new one: it detected the problem, raised, the applier printed
-- "FAILED — nothing was committed", and **every session in the project had in
-- fact already been deleted**. A guard placed after the commit is a report,
-- not a guard.
--
-- It ran on a wrong diagnosis, too. The symptom was the evidence suite
-- crawling — `tier1-writes` at 2 hours instead of 2 minutes, the app stuck on
-- "Restoring your session…" — which looked like GoTrue struggling under 166
-- accumulated sessions for one account. The real cause was that this machine
-- had lost its route to `*.supabase.co` entirely: `connect ETIMEDOUT` on auth,
-- REST and health alike. `e2e-evidence/aa-reachability.spec.ts` now answers
-- that question in ten seconds, first, before anything else runs.
--
-- The assertions below are now INSIDE the transaction, where a RAISE rolls the
-- DELETE back.
--
-- ── WHY IT EXISTS AT ALL ─────────────────────────────────────────────────
--
-- Every Playwright sign-in creates a row in `auth.sessions`, and closing the
-- browser does not remove it. Measured 2026-09-07 after a day of suite runs:
--
--   priya.sharma@wisdomcampus.com    166 live sessions
--   admin@wisdomcampus.com           146
--   mehta.parent@wisdomcampus.com    142
--
-- `closeSession` in `e2e-evidence/fixtures.ts` stops the growth by signing out
-- (`scope=global`, so the row goes, not just the browser's copy). This clears
-- what has accumulated.
--
-- ── WHAT IT WILL AND WILL NOT TOUCH ──────────────────────────────────────
--
-- ONLY sessions untouched for more than 3 hours. A live browser refreshes its
-- token roughly hourly, so a 3-hour-stale session belongs to a window that was
-- closed. The effect on anyone it reaches is that they sign in again: no user,
-- role, membership, identity or application row is touched — `auth.sessions`
-- and its dependent `auth.refresh_tokens` only, which is what was verified
-- after the accident above (64 users, 64 identities, 64 profiles, 21
-- memberships, 20 user_roles, all intact).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM auth.refresh_tokens rt
 WHERE rt.session_id IN (
   SELECT s.id FROM auth.sessions s
    WHERE coalesce(s.updated_at, s.created_at) < now() - interval '3 hours'
 );

DELETE FROM auth.sessions s
 WHERE coalesce(s.updated_at, s.created_at) < now() - interval '3 hours';

-- INSIDE the transaction. A RAISE here rolls the DELETEs back; after COMMIT it
-- could only have described them.
DO $verify$
DECLARE _stale int; _live int;
BEGIN
  SELECT count(*) INTO _stale FROM auth.sessions
   WHERE coalesce(updated_at, created_at) < now() - interval '3 hours';
  IF _stale > 0 THEN
    RAISE EXCEPTION 'ABORT: % abandoned session(s) survived', _stale;
  END IF;

  -- POSITIVE CONTROL. A DELETE that removed EVERYTHING would satisfy the
  -- assertion above and would also have logged out every person currently
  -- using the app. Recent sessions must survive — and if there are none, this
  -- file has nothing to do and must not be the thing that empties the table.
  SELECT count(*) INTO _live FROM auth.sessions;
  IF _live = 0 THEN
    RAISE EXCEPTION
      'ABORT: this would delete EVERY session. Either nobody is signed in (so there is nothing to tidy) or the age window is wrong.';
  END IF;

  RAISE NOTICE 'abandoned sessions cleared; % live session(s) remain', _live;
END $verify$;

COMMIT;
