-- ROLLBACK — Chunk 7C-B (the trigger, state machine and revision clock)
--
-- Safe: nothing reads chapter_state yet. revision_queue and
-- recovery_assignments are still the live system and are untouched.
--
-- Un-wires the state machine from rpc_finish_practice_session FIRST, or the
-- function calls something that no longer exists. The chapter_tally write from
-- 7C-A is left in place — it belongs to the earlier migration.
BEGIN;

DO $unwire$
DECLARE _def text; _new text; _nl text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_finish_practice_session';
  IF _def IS NULL THEN RAISE EXCEPTION '7C-B rollback: rpc_finish_practice_session not found'; END IF;

  -- Detected, not assumed: bodies written before .gitattributes carry CRLF.
  _nl := CASE WHEN _def LIKE '%' || chr(13) || chr(10) || '%'
              THEN chr(13) || chr(10) ELSE chr(10) END;

  _new := replace(_def,
    '    -- §4.1 and §5.2, in that order and AFTER the tally: the engagement' || _nl ||
    '    -- clock reads the rows the tally just wrote.' || _nl ||
    '    PERFORM public._apply_chapter_state(_session_id);' || _nl,
    '');

  IF _new = _def THEN
    RAISE EXCEPTION '7C-B rollback: could not find the state-machine call — inspect the body rather than guessing';
  END IF;
  EXECUTE _new;
END
$unwire$;

DROP FUNCTION IF EXISTS public._apply_chapter_state(uuid);
DROP FUNCTION IF EXISTS public._recovery_const(text);
DROP TABLE IF EXISTS public.recovery_constants;

COMMIT;
