-- THE TREND LINE USES THE ONE ACCURACY.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- rpc_student_performance_charts builds 'practice_trend' with
--
--     'score_pct', round(100.0 * correct_count / NULLIF(question_count, 0), 1)
--
-- question_count is everything the session ASKED. correct + wrong is
-- everything it ANSWERED. Dividing by the first counts a skipped question as
-- a question got wrong, which is the rule §6.6 removed everywhere else:
--
--     20261021000000  rpc_finish_practice_session   accuracy = correct/answered
--     20261022000000  _exam_readiness               stopped counting skips
--     20261013000000  _weak_topics_for_user         stopped counting skips
--
-- This one was missed, and it feeds three surfaces: the Overview tab's "How
-- your score changed" chart, deriveImprovingTopics, and the "Avg score" row
-- of Activity & Speed's month comparison. So the Analysis page drew a trend
-- under one definition of accuracy and printed the tile above it under
-- another.
--
-- MEASURED for one student, 2026-09-17 — the same three sessions:
--
--     correct  wrong  skipped   plotted    should be
--        5       11      4       25.0%       31.3%
--        4       12      4       20.0%       25.0%
--        3        2      0       60.0%       60.0%
--
-- Systematically low, and low by exactly the amount the student skipped. A
-- student who skips what they cannot do is shown a falling line for it.
--
-- ── HOW ─────────────────────────────────────────────────────────────────────
--
-- The live body is edited by text substitution off pg_get_functiondef rather
-- than re-declared, because this function has drifted from every file that
-- claims to define it, and a CREATE OR REPLACE from a file would silently
-- revert whatever else is live. The guard makes the substitution fail closed:
-- if the expression is not found verbatim, nothing is replaced and the
-- migration raises instead of reporting success.
--
-- Live bodies on this database are stored with CRLF; normalised first.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _old_expr text := 'round(100.0 * correct_count / NULLIF(question_count, 0), 1)';
  _new_expr text := 'round(100.0 * correct_count / NULLIF(correct_count + wrong_count, 0), 1)';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n')
    INTO _def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_student_performance_charts';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_student_performance_charts is not defined on this database';
  END IF;

  _new := replace(_def, _old_expr, _new_expr);

  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: the score_pct expression was not found verbatim in the live body';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'practice_trend.score_pct is now correct / answered';
END $$;

-- POSITIVE CONTROL. The old expression must be gone and the new one present.
-- Checking only that the new text appears would pass on a body that carried
-- both.
DO $$
DECLARE
  _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_student_performance_charts';

  IF position('NULLIF(question_count, 0)' IN _def) > 0 THEN
    RAISE EXCEPTION 'would have failed open: the live body still divides by question_count';
  END IF;
  IF position('NULLIF(correct_count + wrong_count, 0)' IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the live body does not divide by answered';
  END IF;
END $$;

COMMIT;
