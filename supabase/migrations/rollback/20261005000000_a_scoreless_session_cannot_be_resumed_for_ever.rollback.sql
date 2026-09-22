-- Rollback for 20261005000000.
--
-- Removes the `plan IS NOT NULL` qualifier from the resume lookup in
-- rpc_start_recovery_session.
--
-- READ THIS FIRST: with the qualifier gone, any student holding an unfinished
-- recovery session that predates 20261001000000 resumes it on every start, and
-- rpc_submit_recovery_session refuses it every time ("this recovery session
-- predates evidence-based scoring"), so recovery becomes permanently
-- unreachable for that chapter.
--
-- The deleted shells are NOT restored. They carried no plan and no outcome —
-- there is nothing to put back, and they are what the trap was made of.

BEGIN;

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='rpc_start_recovery_session';
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$
     -- Only a session that can still be SCORED is worth resuming. A pre-plan
     -- row cannot be, and handing it back on every start would put the
     -- student in front of a session that always refuses.
     AND rs.plan IS NOT NULL$old$, '');
  IF _new = _def THEN RAISE EXCEPTION 'the resume lookup is not the one 20261005000000 wrote'; END IF;

  EXECUTE _new;
END
$undo$;

COMMIT;
