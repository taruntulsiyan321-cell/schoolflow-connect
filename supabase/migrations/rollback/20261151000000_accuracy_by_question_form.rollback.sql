-- ROLLBACK 20261151000000 — rpc_student_practice_analytics without by_form.
--
-- Puts the function back exactly as live had it before 20261151000000 (read
-- 2026-10-09 with pg_get_functiondef). Analysis then shows no "By kind of
-- question" card: the hook reads an absent by_form as no rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_student_practice_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- PREMIUM (20261112000000): topic-level analysis only when the plan has it.
  RETURN public._premium_topic_analysis(_uid, jsonb_build_object(
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
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false))::int AS timed,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false)) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false)
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
          qa.chapter                                                 AS chapter,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false))::int AS timed,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false)) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false) AND COALESCE(btrim(qa.topic), '') <> ''
        -- Topics are per chapter (§10.22): two that share a name are two
        -- topics. Grouped by name alone they merged under max(chapter)
        -- (20261045000000).
        GROUP BY qa.topic, qa.chapter
      ) t
    ),

    'by_chapter', (
      SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.accuracy ASC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.chapter                                                 AS chapter,
          max(qa.subject)                                            AS subject,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false))::int AS timed,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false)) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false)
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
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false))::int AS timed,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false)) / 1000.0, 1) AS avg_sec
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false) AND COALESCE(btrim(qa.difficulty), '') <> ''
        GROUP BY qa.difficulty
      ) d
    ),

    'effort', (
      WITH mine AS (
        SELECT qa.bank_question_id, qa.created_at, qa.is_correct,
               COALESCE(qa.skipped, false) AS skipped
          FROM public.question_attempts qa
         WHERE qa.user_id = _uid
           AND NOT COALESCE(qa.excluded_from_accuracy, false)
      ), firsts AS (
        -- Each bank question's first meeting, by when it happened.
        SELECT DISTINCT ON (m.bank_question_id) m.bank_question_id, m.is_correct, m.skipped
          FROM mine m
         WHERE m.bank_question_id IS NOT NULL
         ORDER BY m.bank_question_id, m.created_at
      )
      SELECT jsonb_build_object(
        'attempts',             (SELECT count(*)::int FROM mine),
        'questions_seen_again', (SELECT count(*)::int FROM (
                                   SELECT 1 FROM mine m
                                    WHERE m.bank_question_id IS NOT NULL
                                    GROUP BY m.bank_question_id
                                   HAVING count(*) > 1) r),
        'first_try_attempts',   (SELECT count(*)::int FROM firsts f WHERE NOT f.skipped),
        'first_try_correct',    (SELECT count(*)::int FROM firsts f WHERE NOT f.skipped AND f.is_correct)
      )
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
  ), ARRAY['by_topic']);
END;
$function$;

COMMIT;
