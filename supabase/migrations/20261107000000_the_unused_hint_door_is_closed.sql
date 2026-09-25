-- ===========================================================================
-- THE UNUSED HINT DOOR IS CLOSED
--
-- rpc_question_hint (20261048000000) served a practice question's "hint". The
-- practice ruling of 2026-09-18 removed the hint: the bank has no hint text,
-- and the "hint" was the worked solution's first 120 characters — the whole
-- answer for 39% of servable questions. The 2026-09-22 release removed its
-- only caller, and it has waited since for database access to go
-- (KNOWN_ISSUES 76). A live SECURITY DEFINER door nothing uses is a door.
--
-- ROLLBACK: rollback/20261107000000_the_unused_hint_door_is_closed.rollback.sql
-- ===========================================================================

BEGIN;

DROP FUNCTION public.rpc_question_hint(uuid);

DO $proof$
BEGIN
  IF to_regprocedure('public.rpc_question_hint(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_question_hint still exists';
  END IF;
END
$proof$;

COMMIT;
