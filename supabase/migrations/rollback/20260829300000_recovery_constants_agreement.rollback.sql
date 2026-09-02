-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — recovery constants agreement
-- Undoes 20260829300000_recovery_constants_agreement.sql
--
-- Undoes two things: the _recovery_const() accessor gains its pre-agreement
-- body, and the three constants this migration introduced are removed.
--
-- The three keys appear in NO earlier migration, so they were introduced here
-- and deleting them restores the prior contents of the table. recovery_constants
-- has no created_at column, so that claim rests on the migration history rather
-- than on a timestamp; the row's updated_at (2026-08-29 12:38) matches when this
-- migration ran, which is consistent with an insert and not with an update of a
-- pre-existing row.
--
-- ── Order matters ─────────────────────────────────────────────────────────
--
-- These rollbacks unwind a CHAIN. Several of these migrations replaced a
-- function that a later one replaced again, so restoring an older body out of
-- order silently discards the newer fix. Apply rollbacks in reverse timestamp
-- order, newest first.
--
-- ── What this file can and cannot promise ─────────────────────────────────
--
-- It restores the definition recorded in the migration named below, which is
-- the last one in this repository before the migration being undone. If some
-- session had replaced that function directly against the database without
-- writing a migration, that out-of-band body is not in the repo and is not
-- recoverable here. Nothing in the repo suggests that happened for these.

-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- _recovery_const() — body extracted verbatim from 20260829250000_chunk7c_b_state_machine.sql
CREATE OR REPLACE FUNCTION public._recovery_const(_key text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Raises rather than defaulting: a missing constant must fail loudly, not
  -- silently behave as 0. A trigger count of 0 would fire on every chapter.
  SELECT CASE WHEN c.value IS NULL
         THEN (SELECT NULL::numeric WHERE false)
         ELSE c.value END
    FROM public.recovery_constants c WHERE c.key = _key;
$function$;


DELETE FROM public.recovery_constants
 WHERE key IN ('GENERATION_TARGET_SECONDS', 'GENERATION_MAX_RETRIES', 'REMINDER_MAX_PER_DAY');


DO $guard$
DECLARE _missing text;
BEGIN
  SELECT string_agg(x, ', ') INTO _missing
    FROM unnest(ARRAY['_recovery_const']) AS x
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = x);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not leave these defined: %', _missing;
  END IF;
END
$guard$;

COMMIT;