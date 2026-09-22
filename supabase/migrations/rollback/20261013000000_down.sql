-- Rollback for 20261013000000_one_wrong_answer_is_not_a_weakness.sql
--
-- Restores the fixed-percentage definition of "weak" and puts the thresholds
-- back at the three call sites.
--
-- What this re-introduces, stated plainly because it is not a neutral undo:
--   * A fixed 60% bar, which measured on production calls 202 of 244 chapter
--     rows weak for a cohort whose overall accuracy is 17.9% — a list of
--     everything, which tells a student nothing about where to start.
--   * Three disagreeing thresholds again: 60 in _rebuild_revision_queue, 60 in
--     rpc_student_academic_snapshot, 65 in rpc_student_improvement_plans.
--   * attempts >= 2, so one wrong answer out of two is 50% and therefore weak.
--   * Skipped questions counted as wrong answers (241 attempts in production).
--   * Chapters a test flagged reported at a fabricated 0% accuracy, which is
--     where 200 of the old 202 weak verdicts came from.
--
-- Nothing is deleted: this function only ever read.

BEGIN;

DROP FUNCTION IF EXISTS public._weak_topics_for_user(uuid);

CREATE FUNCTION public._weak_topics_for_user(_uid uuid)
RETURNS TABLE(subject text, chapter text, topic text, attempts integer, correct integer, accuracy numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH test_stats AS (
    SELECT COALESCE(sm.subject, 'General') AS subject,
           sm.chapter,
           COALESCE(NULLIF(sm.concept, ''), sm.topic, sm.chapter) AS topic,
           count(*)::int AS attempts,
           0::int AS correct
    FROM public.student_mistakes sm
    WHERE sm.user_id = _uid AND sm.source = 'test'
    GROUP BY 1, 2, 3
  ),
  battle_stats AS (
    SELECT b.subject, b.chapter, b.topic,
           count(ba.id)::int AS attempts,
           count(*) FILTER (WHERE ba.is_correct)::int AS correct
    FROM public.battle_participants bp
    JOIN public.battles b ON b.id = bp.battle_id
    JOIN public.battle_answers ba ON ba.participant_id = bp.id
    WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL
    GROUP BY b.subject, b.chapter, b.topic
  ),
  practice_stats AS (
    SELECT
      COALESCE(qt.subject, ps.subject) AS subject,
      COALESCE(qt.chapter, ps.chapter) AS chapter,
      COALESCE(NULLIF(qt.concept, ''), qt.chapter, ps.chapter) AS topic,
      count(*)::int AS attempts,
      count(*) FILTER (WHERE qa.is_correct)::int AS correct
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    LEFT JOIN public.question_templates qt ON qt.id = qa.template_id
    WHERE qa.user_id = _uid
    GROUP BY
      COALESCE(qt.subject, ps.subject),
      COALESCE(qt.chapter, ps.chapter),
      COALESCE(NULLIF(qt.concept, ''), qt.chapter, ps.chapter)
  ),
  combined AS (
    SELECT subject, chapter, topic, sum(attempts) AS attempts, sum(correct) AS correct
    FROM (
      SELECT * FROM test_stats
      UNION ALL SELECT * FROM battle_stats
      UNION ALL SELECT * FROM practice_stats
    ) u
    GROUP BY subject, chapter, topic
  )
  SELECT subject, chapter, topic, attempts::int, correct::int,
         CASE WHEN attempts > 0 THEN round(100.0 * correct / attempts, 1) ELSE 0 END AS accuracy
  FROM combined
  WHERE attempts >= 2;
$fn$;

-- Put each caller's own threshold back, by substitution against the live body
-- for the same reason the forward migration used substitution: these functions
-- have been rewritten in place many times and a body typed from a file would
-- revert whichever change came last.
DO $rewrite$
DECLARE
  _fn   text;
  _def  text;
  _new  text;
  _pairs text[][] := ARRAY[
    ['_rebuild_revision_queue',        'w.is_weak', 'w.accuracy < 60'],
    ['rpc_student_academic_snapshot',  'w.is_weak', 'w.accuracy < 60'],
    ['rpc_student_improvement_plans',  'w.is_weak', 'w.accuracy < 65']
  ];
  _i int;
BEGIN
  FOR _i IN 1 .. array_length(_pairs, 1) LOOP
    _fn := _pairs[_i][1];

    SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = _fn;

    IF _def IS NULL THEN
      RAISE EXCEPTION 'function public.% not found', _fn;
    END IF;

    _new := replace(_def, _pairs[_i][2], _pairs[_i][3]);
    IF _new = _def THEN
      _new := replace(_def,
                      replace(_pairs[_i][2], 'w.', ''),
                      replace(_pairs[_i][3], 'w.', ''));
    END IF;
    IF _new = _def THEN
      RAISE EXCEPTION 'the anchor % matched nothing in % — the substitution would have failed open',
        _pairs[_i][2], _fn;
    END IF;

    EXECUTE _new;
  END LOOP;
END $rewrite$;

DELETE FROM public.recovery_constants
 WHERE key IN ('WEAK_MIN_ATTEMPTS', 'WEAK_MARGIN_POINTS', 'WEAK_WINDOW_DAYS');

COMMIT;
