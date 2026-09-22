-- Rollback for 20261022000000_one_practice_accuracy.sql
--
-- Restores the two older definitions.
--
-- What this re-introduces, stated plainly because it is not a neutral undo:
--   * The Home tile counts a skipped question as a wrong answer again, so the
--     same practice reads 26% there and 28% on Analysis (measured: 22 correct,
--     78 answered, 8 skipped).
--   * The profile row teacher and parent views read goes back to a MEAN of
--     per-session percentages, where a 1-question session weighs as much as a
--     40-question one.

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='_exam_readiness';
  _new := replace(_def,
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;',
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct) / NULLIF(count(*), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;');
  IF _new = _def THEN RAISE EXCEPTION 'anchor matched nothing in _exam_readiness'; END IF;
  EXECUTE _new;
END $rewrite$;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND p.proname='refresh_student_academic_profile';
  _new := replace(_def,
    'SELECT count(*), coalesce(
    100.0 * sum(correct_count)::numeric
          / NULLIF(sum(GREATEST(question_count - COALESCE(skipped_count, 0), 0)), 0), 0)
  INTO _practice_n, _practice_avg',
    'SELECT count(*), coalesce(avg(
    CASE WHEN question_count > 0 THEN (correct_count::numeric / question_count) * 100 ELSE NULL END
  ), 0)
  INTO _practice_n, _practice_avg');
  IF _new = _def THEN RAISE EXCEPTION 'anchor matched nothing in refresh_student_academic_profile'; END IF;
  EXECUTE _new;
END $rewrite$;

COMMIT;
