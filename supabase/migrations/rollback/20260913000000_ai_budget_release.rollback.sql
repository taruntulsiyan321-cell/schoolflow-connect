-- Rollback for 20260913000000_ai_budget_release.sql
--
-- The migration only ADDED a function; nothing existing was altered, so the
-- rollback is a drop. `ai_budget_check_and_reserve` is untouched by both.
--
-- ORDER MATTERS FOR THE CALLER, NOT FOR THE DATABASE. Dropping this while a
-- deployed `dpp-generate-questions` still calls it turns every failed
-- generation's release into a PostgREST 404 — which the function swallows by
-- design, so the school silently goes back to being charged for failures. If
-- this is rolled back, redeploy the edge function from before the release call
-- as well, or accept that behaviour knowingly.
--
-- Nothing is un-credited: releases already performed reduced `units_used` and
-- stay reduced. There is no ledger of individual reservations to replay, which
-- is the same reason the migration does not retro-credit past failures.

BEGIN;

DROP FUNCTION IF EXISTS public.ai_budget_release(uuid, text, numeric);

COMMIT;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'ai_budget_release'
  ) THEN
    RAISE EXCEPTION 'ABORT: ai_budget_release is still present after rollback';
  END IF;
  -- Positive control: the thing this rollback must NOT have taken with it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'ai_budget_check_and_reserve'
  ) THEN
    RAISE EXCEPTION 'ABORT: the rollback removed ai_budget_check_and_reserve as well';
  END IF;
  RAISE NOTICE 'ai_budget_release dropped; the reservation function is intact.';
END $verify$;
