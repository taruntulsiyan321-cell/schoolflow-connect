-- THE SUBJECT LIST IS EVERY SUBJECT PRACTISED.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- The Subjects & Chapters tab draws a radar and a "Subjects at a glance" list,
-- both from rpc_student_performance_charts.subjects, which aggregates
-- _weak_topics_for_user. That function only returns rows it can resolve to a
-- TOPIC through the question bank, so a subject whose attempts are not
-- bank-backed does not appear at all.
--
-- Measured 2026-09-18, one student's attempts by subject:
--
--     Mathematics     408          _weak_topics_for_user:  Mathematics 220
--     Social Science   79                                  (nothing else)
--     English          54
--     Hindi            11
--     Science          11
--     Chemistry         1
--
-- Six subjects practised, one subject on the tab. The radar — a chart whose
-- whole purpose is comparing subjects against each other — was drawing a
-- single point, and the two panels beside it disagreed with the speed panel on
-- the Practice tab, which reads practice_sessions and therefore knew about
-- Social Science.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- Adds `by_subject` to rpc_student_practice_analytics, aggregated from
-- question_attempts like by_chapter and by_topic beside it. Subject, chapter
-- and topic then all come from the one durable record, so the three levels of
-- the same tab cannot disagree about which subjects exist.
--
-- _weak_topics_for_user is NOT changed. It is the weak-TOPIC engine and it is
-- right to be bank-backed: a topic that is not in the bank cannot be recovered
-- or revised, so it has no business in a weak-topic list. What was wrong was
-- using it as the subject census.

CREATE OR REPLACE FUNCTION public.rpc_student_practice_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN jsonb_build_object(
    -- ── by subject ───────────────────────────────────────────────────────
    -- Every subject this student has attempted a question in, most attempts
    -- first. The generic buckets are excluded by the same list the chapter
    -- roll-up uses: "Subject" is not a subject.
    'by_subject', (
      SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.attempts DESC), '[]'::jsonb)
      FROM (
        SELECT
          public._normalize_subject_label(qa.subject)                AS subject,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND public._normalize_subject_label(qa.subject) IS NOT NULL
        GROUP BY public._normalize_subject_label(qa.subject)
      ) s
    ),

    'by_topic', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.avg_sec DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.topic                                                   AS topic,
          max(qa.subject)                                            AS subject,
          max(qa.chapter)                                            AS chapter,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid AND COALESCE(btrim(qa.topic), '') <> ''
        GROUP BY qa.topic
      ) t
    ),

    'by_chapter', (
      SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.accuracy ASC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.chapter                                                 AS chapter,
          max(qa.subject)                                            AS subject,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND COALESCE(btrim(qa.chapter), '') <> ''
          AND lower(btrim(qa.chapter)) NOT IN
              ('subject', 'topic', 'daily', 'general', 'concept', 'chapter', 'mixed')
        GROUP BY qa.chapter
      ) c
    ),

    'by_difficulty', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.rank), '[]'::jsonb)
      FROM (
        SELECT
          qa.difficulty                                              AS difficulty,
          CASE lower(qa.difficulty) WHEN 'easy' THEN 1 WHEN 'medium' THEN 2
                                    WHEN 'hard' THEN 3 ELSE 4 END    AS rank,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid AND COALESCE(btrim(qa.difficulty), '') <> ''
        GROUP BY qa.difficulty
      ) d
    ),

    'effort', (
      SELECT jsonb_build_object(
        'attempts',          count(*)::int,
        'solution_viewed',   count(*) FILTER (WHERE COALESCE(qa.solution_viewed, false))::int,
        'repeat_attempts',   count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) > 1)::int,
        'first_try_attempts', count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) = 1
                                                 AND NOT COALESCE(qa.skipped, false))::int,
        'first_try_correct',  count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) = 1
                                                 AND qa.is_correct AND NOT COALESCE(qa.skipped, false))::int
      )
      FROM public.question_attempts qa WHERE qa.user_id = _uid
    ),

    'recurring', (
      SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.times_wrong DESC, r.last_wrong_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          sm.topic                  AS topic,
          sm.chapter                AS chapter,
          sm.subject                AS subject,
          sm.times_wrong            AS times_wrong,
          sm.last_wrong_at          AS last_wrong_at,
          left(sm.question_text, 160) AS question_text
        FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.status = 'open' AND COALESCE(sm.times_wrong, 0) > 1
        ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
        LIMIT 8
      ) r
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_student_practice_analytics() FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_student_practice_analytics() TO authenticated;
