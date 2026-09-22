-- Rollback for 20260929000000.
--
-- Puts the practice trend back to plotting a session nobody sat as a 0% point,
-- and puts the snapshot's attempt sum back inline instead of asking the shared
-- helper for it.
--
-- READ THIS FIRST: only run this if something depends on those zero points.
-- Nothing in this repository does. A session the loader could not fill is
-- auto-finished with no attempts and rpc_finish_practice_session leaves
-- question_count at the count that was ASKED FOR, so the point is a flat 0%
-- for a student who was never shown a question.
--
-- The helper itself is left in place. It is a pure three-argument predicate
-- with no callers after this rollback, and dropping it would take the comment
-- recording WHY the rule exists with it.

BEGIN;

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_student_performance_charts';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_student_performance_charts not found'; END IF;
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$        -- A session with no attempts is not a point on a trend line. Its
        -- question_count is the count that was ASKED FOR, so it plots as a
        -- flat 0% for a student who was never shown a question.
        AND public._practice_session_attempted(correct_count, wrong_count, skipped_count)
$old$, '');
  IF _new = _def THEN RAISE EXCEPTION 'the trend filter is not the one 20260929000000 wrote'; END IF;
  EXECUTE _new;

  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_student_academic_snapshot';
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
    'AND public._practice_session_attempted(correct_count, wrong_count, skipped_count);',
    'AND (COALESCE(correct_count, 0) + COALESCE(wrong_count, 0) + COALESCE(skipped_count, 0)) > 0;');
  IF _new = _def THEN RAISE EXCEPTION 'the snapshot predicate is not the one 20260929000000 wrote'; END IF;
  EXECUTE _new;

  RAISE NOTICE 'both reads carry their own copy of the attempt sum again';
END
$undo$;

COMMIT;
