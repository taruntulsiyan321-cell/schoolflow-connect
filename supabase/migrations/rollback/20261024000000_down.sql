-- Rollback for 20261024000000_a_topic_is_a_topic_not_the_chapter.sql
--
-- Flattens `topic` back to the chapter.
--
-- What this re-introduces, stated plainly because it is not a neutral undo:
--   * The Analysis tab's topic-wise breakdown shows CHAPTERS under a "topic"
--     heading — 13 rows where the data supports 49.
--   * Every weak-topic verdict becomes a weak-chapter verdict again, and
--     topic practice narrows on a chapter.
--   * Battle topics and test-flagged concepts are flattened to the chapter
--     even though both are stored.
--
-- The 7 deleted revision_queue rows are not restored: they were derived rows
-- that _rebuild_revision_queue regenerates on its next run.

BEGIN;

CREATE OR REPLACE FUNCTION public._weak_topics_for_user(_uid uuid)
 RETURNS TABLE(subject text, chapter text, topic text, attempts integer, correct integer, accuracy numeric, is_weak boolean, baseline_accuracy numeric, last_attempt_at timestamp with time zone, thin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH k AS (
    SELECT public._recovery_const('WEAK_MIN_ATTEMPTS')::int   AS min_attempts,
           public._recovery_const('WEAK_MARGIN_POINTS')::numeric AS margin,
           public._recovery_const('WEAK_WINDOW_DAYS')::int    AS window_days
  ),
  practice AS (
    SELECT ps.subject AS subject, ps.chapter AS chapter, qa.created_at, qa.is_correct
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    WHERE qa.user_id = _uid AND NOT COALESCE(qa.skipped, false)
  ),
  battle AS (
    SELECT b.subject, b.chapter, ba.created_at, ba.is_correct
      FROM public.battle_participants bp
      JOIN public.battles b        ON b.id = bp.battle_id
      JOIN public.battle_answers ba ON ba.participant_id = bp.id
     WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL
  ),
  graded AS (SELECT * FROM practice UNION ALL SELECT * FROM battle),
  windowed AS (
    SELECT COALESCE(subject, 'General') AS subject, chapter,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE is_correct)::int AS correct,
           max(created_at) AS last_attempt_at
      FROM graded, k
     WHERE created_at >= now() - make_interval(days => k.window_days)
     GROUP BY 1, 2
  ),
  lifetime AS (
    SELECT COALESCE(subject, 'General') AS subject, chapter,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE is_correct)::int AS correct,
           max(created_at) AS last_attempt_at
      FROM graded GROUP BY 1, 2
  ),
  chosen AS (
    SELECT l.subject, l.chapter,
           CASE WHEN COALESCE(w.attempts, 0) >= (SELECT min_attempts FROM k)
                THEN w.attempts ELSE l.attempts END AS attempts,
           CASE WHEN COALESCE(w.attempts, 0) >= (SELECT min_attempts FROM k)
                THEN w.correct  ELSE l.correct  END AS correct,
           l.last_attempt_at
      FROM lifetime l
      LEFT JOIN windowed w ON w.subject = l.subject
            AND COALESCE(w.chapter, '') = COALESCE(l.chapter, '')
  ),
  test_only AS (
    SELECT COALESCE(sm.subject, 'General') AS subject, sm.chapter,
           0::int AS attempts, 0::int AS correct, max(sm.last_wrong_at) AS last_attempt_at
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.source = 'test'
     GROUP BY 1, 2
    EXCEPT ALL
    SELECT c.subject, c.chapter, 0, 0, c.last_attempt_at FROM chosen c
  ),
  combined AS (
    SELECT * FROM chosen
    UNION ALL
    SELECT t.subject, t.chapter, t.attempts, t.correct, t.last_attempt_at
      FROM test_only t
     WHERE NOT EXISTS (
       SELECT 1 FROM chosen c
        WHERE c.subject = t.subject
          AND COALESCE(c.chapter, '') = COALESCE(t.chapter, ''))
  ),
  baseline AS (
    SELECT CASE WHEN sum(attempts) > 0
                THEN round(100.0 * sum(correct) / sum(attempts), 1)
                ELSE NULL END AS acc
      FROM combined
  )
  SELECT c.subject, c.chapter, c.chapter AS topic, c.attempts, c.correct,
    CASE WHEN c.attempts > 0 THEN round(100.0 * c.correct / c.attempts, 1) ELSE 0 END AS accuracy,
    (c.attempts >= (SELECT min_attempts FROM k) AND b.acc IS NOT NULL
      AND round(100.0 * c.correct / c.attempts, 1) <= b.acc - (SELECT margin FROM k)) AS is_weak,
    b.acc AS baseline_accuracy, c.last_attempt_at,
    (c.attempts < (SELECT min_attempts FROM k)) AS thin
  FROM combined c CROSS JOIN baseline b
  ORDER BY (c.attempts >= (SELECT min_attempts FROM k)) DESC,
    CASE WHEN c.attempts > 0 THEN 100.0 * c.correct / c.attempts ELSE 999 END ASC;
$function$;

COMMIT;
