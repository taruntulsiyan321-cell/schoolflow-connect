-- Rollback for 20260923000000.
--
-- Restores the guard that reads `offerable`, a key rpc_recovery_session_plan
-- does not return. `->>` on an absent key is NULL, COALESCE makes it false,
-- and the guard then fires on every call — so rpc_start_recovery_session
-- returns started:false always and NO recovery session can ever be created.
--
-- There is no reason to run this. It exists because every migration in this
-- repository ships with its reverse, not because the previous behaviour is
-- worth returning to.

BEGIN;

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_start_recovery_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_start_recovery_session not found'; END IF;

  _new := replace(_def,
    '_ok := COALESCE((_plan->>''complete'')::boolean, false)
      OR COALESCE((_plan->>''offerable_if_generation_exhausted'')::boolean, false);',
    '_ok := COALESCE((_plan->>''offerable'')::boolean, false);');

  IF _new = _def THEN
    RAISE NOTICE 'the corrected guard was not found; nothing undone';
  ELSE
    EXECUTE _new;
    RAISE WARNING 'rpc_start_recovery_session can no longer start a session.';
  END IF;
END
$undo$;

COMMIT;
