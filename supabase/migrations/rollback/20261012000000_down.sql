-- Rollback for 20261012000000_the_missing_rungs_get_written.sql
--
-- Unschedules the drain, drops the queue, and restores _ensure_recovery_session
-- to the version that prepared a session without queueing anything.
--
-- What this returns the system to, stated plainly: tiers 1 and 2 of the
-- transfer ladder fill from a bank that gains nothing, so every recovery
-- session runs short at exactly the two rungs §4.2 calls the most useful. That
-- was the state for the whole life of the feature until this migration.
--
-- VARIANTS ALREADY IN THE BANK ARE KEPT. They are ordinary approved questions
-- (§4.2a: "Variants are ordinary bank questions. They can be served in normal
-- practice to any student, which is fine and desirable"), they are already
-- being served, and deleting them would silently shorten sessions students
-- have in progress. Removing them is a separate, deliberate act:
--
--   DELETE FROM public.question_bank WHERE source = 'ai_recovery_variant';
--
-- THE SECRET IS NOT REVOKED HERE. The vault row variant_generation_drain and
-- the function's VARIANT_GENERATION_DRAIN environment secret both survive, so
-- re-applying the forward migration works without re-issuing them. If the
-- rollback is permanent, retire both by hand:
--
--   SELECT vault.update_secret(id, '<new random>') FROM vault.secrets
--    WHERE name = 'variant_generation_drain';
--   -- and delete the function secret in the Supabase dashboard.

BEGIN;

SELECT cron.unschedule('drain-variant-generation');

DROP FUNCTION IF EXISTS public.dispatch_variant_generation();
DROP FUNCTION IF EXISTS public._enqueue_variant_generation(jsonb);

-- The version from 20261009000000, without the enqueue call.
CREATE OR REPLACE FUNCTION public._ensure_recovery_session(
  _uid uuid, _student_id uuid, _school_id uuid, _chapter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _plan  jsonb;
  _round int;
  _rid   uuid;
  _tot   int[] := ARRAY[0,0,0,0];
  _i     int;
BEGIN
  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
     AND rs.completed_at IS NULL AND rs.plan IS NOT NULL
   LIMIT 1;
  IF _rid IS NOT NULL THEN RETURN _rid; END IF;

  _plan := public._recovery_session_plan_for(_uid, _chapter_id);

  IF _plan->>'mode' IN ('relearn', 'none') THEN RETURN NULL; END IF;
  IF NOT (COALESCE((_plan->>'complete')::boolean, false)
          OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false)) THEN
    RETURN NULL;
  END IF;

  FOR _i IN 0..3 LOOP
    _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _student_id, _school_id, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;

  RETURN _rid;
END;
$fn$;

-- Dropped after the function that referenced it.
DROP TABLE IF EXISTS public.variant_generation_queue;

DELETE FROM public.recovery_constants WHERE key = 'GENERATION_BATCH_SIZE';

COMMIT;
