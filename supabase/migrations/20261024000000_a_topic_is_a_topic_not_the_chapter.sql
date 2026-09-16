-- ════════════════════════════════════════════════════════════════════════════
-- A TOPIC IS A TOPIC, NOT THE CHAPTER
-- ════════════════════════════════════════════════════════════════════════════
--
-- A DEFECT I INTRODUCED IN 20261013000000, TODAY
--
-- That migration rewrote _weak_topics_for_user and removed a join to
-- question_templates, correctly: zero of 4,841 attempts carried a template_id,
-- so the join never matched. But it drew the wrong conclusion from that and
-- wrote:
--
--     -- Topic IS the chapter, stated rather than implied.
--     c.chapter AS topic,
--
-- The join was dead. The TOPIC was not. question_attempts carries
-- bank_question_id, question_bank carries topic_id, and topics carries the
-- name — the taxonomy 20261020000000/20261020010000 put there. Removing a dead
-- path and declaring the destination unreachable is not the same as looking
-- for the live one.
--
-- WHAT IT COSTS, MEASURED
--
--   attempts with a bank_question_id          212
--   of those, topic resolves to a real name   212   (100%)
--   distinct topics available                  49
--   distinct chapters they sit in              13
--
-- So topic-wise analysis has been showing chapters under a "topic" heading,
-- at a quarter of the granularity the data supports, and every weak-topic
-- verdict has been a weak-CHAPTER verdict. This is the column the Analysis
-- tab's topic breakdown reads and the one topic practice narrows on.
--
-- THE FALLBACK IS HONEST, NOT COSMETIC
--
-- 4,800 older attempts carry no bank_question_id at all — they came from the
-- retired template/AI path and their topic is genuinely unknowable. Those fall
-- back to the chapter, which is what they have always effectively been. New
-- practice is bank-backed, so it resolves properly.
--
-- Battles already store their own topic text, and a test-flagged row already
-- carries concept/topic on student_mistakes. Both are now read rather than
-- being flattened to the chapter.
--
-- THE CHAPTER KEY IS DELIBERATELY UNTOUCHED
--
-- chapter stays ps.chapter. The chapter is the scheduling unit for recovery
-- and revision (§2), and re-keying it from the bank at the same time as adding
-- topic would move two things at once and make a regression impossible to
-- attribute.
--
-- STALE QUEUE ROWS
--
-- _rebuild_revision_queue writes revision_queue.topic from this function and
-- matches on (subject, chapter, topic), so rows written while topic meant
-- "chapter" can no longer match and would never auto-clear. There are 7 such
-- rows (reason = 'weak_topic', topic = chapter). They are derived data and
-- _rebuild_revision_queue recreates them at the correct granularity, so they
-- are deleted rather than left to leak.
--
-- ROLLBACK: supabase/migrations/rollback/20261024000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

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
  -- ── Practice, the only source with a real denominator ──────────────────
  -- SKIPS ARE EXCLUDED, not counted as wrong. rpc_record_question_attempt
  -- forces is_correct false on a skip, so leaving them in silently lowered
  -- every chapter a student skipped in.
  --
  -- The topic comes from the question itself: bank_question_id -> topic_id ->
  -- topics.name. An attempt with no bank_question_id (4,800 legacy rows from
  -- the retired template path) has no knowable topic and falls back to the
  -- chapter, which is what it has always effectively been.
  practice AS (
    SELECT
      ps.subject                   AS subject,
      ps.chapter                   AS chapter,
      COALESCE(t.name, ps.chapter) AS topic,
      qa.created_at,
      qa.is_correct
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps  ON ps.id = qa.session_id
    LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    LEFT JOIN public.topics t         ON t.id = qb.topic_id
    WHERE qa.user_id = _uid
      AND NOT COALESCE(qa.skipped, false)
  ),
  battle AS (
    SELECT b.subject, b.chapter, COALESCE(b.topic, b.chapter) AS topic,
           ba.created_at, ba.is_correct
      FROM public.battle_participants bp
      JOIN public.battles b         ON b.id = bp.battle_id
      JOIN public.battle_answers ba ON ba.participant_id = bp.id
     WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL
  ),
  graded AS (
    SELECT * FROM practice
    UNION ALL SELECT * FROM battle
  ),
  -- Within the window first; all time is the fallback for a thin window.
  windowed AS (
    SELECT COALESCE(subject, 'General') AS subject,
           chapter, topic,
           count(*)::int                                   AS attempts,
           count(*) FILTER (WHERE is_correct)::int          AS correct,
           max(created_at)                                  AS last_attempt_at
      FROM graded, k
     WHERE created_at >= now() - make_interval(days => k.window_days)
     GROUP BY 1, 2, 3
  ),
  lifetime AS (
    SELECT COALESCE(subject, 'General') AS subject,
           chapter, topic,
           count(*)::int                                   AS attempts,
           count(*) FILTER (WHERE is_correct)::int          AS correct,
           max(created_at)                                  AS last_attempt_at
      FROM graded
     GROUP BY 1, 2, 3
  ),
  chosen AS (
    SELECT l.subject, l.chapter, l.topic,
           CASE WHEN COALESCE(w.attempts, 0) >= (SELECT min_attempts FROM k)
                THEN w.attempts ELSE l.attempts END AS attempts,
           CASE WHEN COALESCE(w.attempts, 0) >= (SELECT min_attempts FROM k)
                THEN w.correct  ELSE l.correct  END AS correct,
           l.last_attempt_at
      FROM lifetime l
      LEFT JOIN windowed w
             ON w.subject = l.subject
            AND COALESCE(w.chapter, '') = COALESCE(l.chapter, '')
            AND COALESCE(w.topic, '')   = COALESCE(l.topic, '')
  ),
  -- Topics a TEST flagged and practice has never covered.
  --
  -- A test leaves only its wrong answers behind (§10.8), so it can say a
  -- topic was missed but cannot say how often it was right. Such a row is
  -- surfaced as THIN — zero attempts, no accuracy, no verdict — rather than as
  -- a fabricated 0%, which is what the pre-20261013 body emitted and what put
  -- 200 of its 202 "weak" rows on the list.
  test_only AS (
    SELECT COALESCE(sm.subject, 'General') AS subject,
           sm.chapter,
           COALESCE(NULLIF(sm.concept, ''), sm.topic, sm.chapter) AS topic,
           0::int          AS attempts,
           0::int          AS correct,
           max(sm.last_wrong_at) AS last_attempt_at
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.source = 'test'
     GROUP BY 1, 2, 3
    EXCEPT ALL
    SELECT c.subject, c.chapter, c.topic, 0, 0, c.last_attempt_at FROM chosen c
  ),
  combined AS (
    SELECT * FROM chosen
    UNION ALL
    SELECT t.subject, t.chapter, t.topic, t.attempts, t.correct, t.last_attempt_at
      FROM test_only t
     WHERE NOT EXISTS (
       SELECT 1 FROM chosen c
        WHERE c.subject = t.subject
          AND COALESCE(c.chapter, '') = COALESCE(t.chapter, '')
          AND COALESCE(c.topic, '')   = COALESCE(t.topic, ''))
  ),
  -- THE BASELINE: this student's own accuracy over the same evidence, which is
  -- what makes "weak" mean "worse than you usually do" rather than "under a
  -- number somebody picked".
  baseline AS (
    SELECT CASE WHEN sum(attempts) > 0
                THEN round(100.0 * sum(correct) / sum(attempts), 1)
                ELSE NULL END AS acc
      FROM combined
  )
  SELECT
    c.subject,
    c.chapter,
    c.topic,
    c.attempts,
    c.correct,
    CASE WHEN c.attempts > 0
         THEN round(100.0 * c.correct / c.attempts, 1) ELSE 0 END AS accuracy,
    (
      c.attempts >= (SELECT min_attempts FROM k)
      AND b.acc IS NOT NULL
      AND round(100.0 * c.correct / c.attempts, 1) <= b.acc - (SELECT margin FROM k)
    ) AS is_weak,
    b.acc AS baseline_accuracy,
    c.last_attempt_at,
    (c.attempts < (SELECT min_attempts FROM k)) AS thin
  FROM combined c
  CROSS JOIN baseline b
  ORDER BY
    (c.attempts >= (SELECT min_attempts FROM k)) DESC,
    CASE WHEN c.attempts > 0 THEN 100.0 * c.correct / c.attempts ELSE 999 END ASC;
$function$;

-- The rewrite must be live, and the flattening must be gone.
DO $check$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_weak_topics_for_user';

  IF position('c.chapter AS topic' IN _def) > 0 THEN
    RAISE EXCEPTION 'topic is still flattened to the chapter';
  END IF;
  IF position('public.topics t' IN _def) = 0 THEN
    RAISE EXCEPTION 'the topics join is not in the live body';
  END IF;
END $check$;

-- Rows keyed on the old meaning of `topic`. Derived data; _rebuild_revision_queue
-- recreates them at the correct granularity.
DELETE FROM public.revision_queue
 WHERE reason = 'weak_topic'
   AND COALESCE(topic, '') = COALESCE(chapter, '');

COMMIT;
