-- ROLLBACK for 20261035000000_active_days_is_a_count_of_days.
--
-- READ THIS FIRST. This restores a defect in which
-- _exam_readiness.active_days_14d reports the SUM OF ACTIVITY COUNTS over the
-- last fourteen days under a name that says days — so the Analysis header
-- prints things like "15 active days (14d)", and every value below fourteen is
-- wrong in the same way while looking plausible.
--
-- The readiness composite is untouched by both directions: _practice, which
-- feeds the score, was never changed.
--
-- Same technique as the forward migration — substitution off the live body,
-- failing closed if the text is not found.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _block text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_exam_readiness';

  _block :=
    E'\n' ||
    E'  -- DAYS, not activities. _practice above is a SUM of counts and feeds\n' ||
    E'  -- the readiness composite, which is what it is right for. The screen\n' ||
    E'  -- asks how many days the student showed up, and one day with four\n' ||
    E'  -- sessions on it is one day.\n' ||
    E'  SELECT count(DISTINCT activity_date) INTO _active_days\n' ||
    E'    FROM public.academic_daily_activity\n' ||
    E'   WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14\n' ||
    E'     AND (test_count + homework_count + battle_count + self_practice_count) > 0;\n';

  IF position(_block IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the _active_days block was not found verbatim';
  END IF;

  _new := replace(_def, _block, '');
  _new := replace(_new, E'''active_days_14d'', _active_days', E'''active_days_14d'', _practice');
  _new := replace(_new, E'\n  _active_days int := 0;', '');

  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: nothing was substituted';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'active_days_14d is back to counting activities, not days';
END $$;

COMMIT;
