-- ROLLBACK for 20261031000000_the_trend_line_uses_the_one_accuracy.
--
-- READ THIS FIRST. This restores the defect: the Overview trend chart goes
-- back to counting a skipped question as one got wrong, and will again
-- disagree with the accuracy tile printed directly above it.
--
-- Same technique as the forward migration — substitution off the live body,
-- failing closed if the expression is not found verbatim.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_student_performance_charts';

  _new := replace(_def,
    'round(100.0 * correct_count / NULLIF(correct_count + wrong_count, 0), 1)',
    'round(100.0 * correct_count / NULLIF(question_count, 0), 1)');

  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: the answered-denominator expression was not found';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'practice_trend.score_pct is back on question_count';
END $$;

COMMIT;
