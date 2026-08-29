-- ROLLBACK — Chunk 7C-A (recovery/revision tables + the chapter_tally writer)
--
-- Safe: nothing reads these yet. 7C-A adds tables and one internal writer;
-- revision_queue and recovery_assignments are still the live system and are
-- untouched, per the 7.5 ordering.
--
-- The tally rows are dropped with the table they live in — chapter_tally
-- itself belongs to 7B and is NOT dropped here, only the writer that fills it.
BEGIN;

-- Un-wire the writer from rpc_finish_practice_session first, or the function
-- calls something that no longer exists.
DO $unwire$
DECLARE _def text; _new text; _nl text := chr(13) || chr(10);
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_finish_practice_session';
  IF _def IS NULL THEN RAISE EXCEPTION '7C-A rollback: rpc_finish_practice_session not found'; END IF;

  _new := replace(_def,
    '  -- §3.1: the denominator. Eight open mistakes in Cash Flow means' || _nl ||
    '  -- something entirely different out of 20 questions than out of 200.' || _nl ||
    '  BEGIN' || _nl ||
    '    PERFORM public._write_chapter_tally(_session_id);' || _nl ||
    '  EXCEPTION WHEN OTHERS THEN' || _nl ||
    '    RAISE WARNING ''rpc_finish_practice_session(%): chapter tally failed: %'', _session_id, SQLERRM;' || _nl ||
    '  END;' || _nl || _nl,
    '');

  IF _new = _def THEN
    RAISE EXCEPTION '7C-A rollback: could not find the tally block — inspect the body rather than guessing';
  END IF;
  EXECUTE _new;
END
$unwire$;

DROP FUNCTION IF EXISTS public._write_chapter_tally(uuid);
DROP TABLE IF EXISTS public.revision_sessions;
DROP TABLE IF EXISTS public.recovery_sessions;
DROP TABLE IF EXISTS public.chapter_state;

COMMIT;
