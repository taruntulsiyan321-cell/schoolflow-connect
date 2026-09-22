-- Rollback for 20260930000000.
--
-- Drops total_time_ms back out of rpc_finish_practice_session's RETURN.
--
-- READ THIS FIRST: Practice.tsx reads fin.total_time_ms and will go back to
-- receiving undefined, so the result screen for a session the student has just
-- finished shows no duration. The practice history list is unaffected — it
-- reads the column straight off practice_sessions. There is no reason to run
-- this except to reproduce the old behaviour.

BEGIN;

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_finish_practice_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_finish_practice_session not found'; END IF;
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def, E'    ''total_time_ms'', _s.total_time_ms,\n', '');
  IF _new = _def THEN RAISE EXCEPTION 'the RETURN is not the one 20260930000000 wrote'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'the finish no longer returns total_time_ms';
END
$undo$;

COMMIT;
