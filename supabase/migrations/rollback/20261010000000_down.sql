-- Rollback for 20261010000000_one_home_for_the_relearn_boundary.sql
--
-- Puts the duplicate RECOVERY_RELEARN_ABOVE row back and points the two
-- readers at it again.
--
-- This restores a state `npm run check:recovery-constants` fails on: the row
-- and the module's derived declaration cannot both be true. That is the point
-- of the rollback — it returns the database to exactly where the forward
-- migration found it, including the problem — but it means the gate will be
-- red until the module declaration is changed to match.

BEGIN;

INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('RECOVERY_RELEARN_ABOVE', 8, '§4.2',
   'Above this, a recovery session is the wrong answer and is not offered.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

DO $rewrite$
DECLARE
  _fn   text;
  _def  text;
  _new  text;
BEGIN
  FOREACH _fn IN ARRAY ARRAY['_recovery_session_plan_for', 'rpc_student_recovery_queue'] LOOP
    SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = _fn;

    IF _def IS NULL THEN
      RAISE EXCEPTION 'function public.% not found', _fn;
    END IF;

    -- Only the reads the forward migration rewrote. _recovery_session_plan_for
    -- reads RECOVERY_WIDE_MAX_MISTAKES for the wide band as well, and that read
    -- must survive — so the anchor is the assignment to _relearn_above, not the
    -- constant name on its own.
    _new := replace(
      _def,
      '_relearn_above := public._recovery_const(''RECOVERY_WIDE_MAX_MISTAKES'')::int;',
      '_relearn_above := public._recovery_const(''RECOVERY_RELEARN_ABOVE'')::int;');

    IF _new = _def THEN
      RAISE EXCEPTION 'the substitution changed nothing in % — it would have failed open', _fn;
    END IF;

    EXECUTE _new;
  END LOOP;
END $rewrite$;

COMMIT;
