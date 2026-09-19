-- A VERDICT COUNTS THE ANSWERS BEHIND IT, NOT THE QUESTIONS SHOWN.
--
-- rpc_student_practice_analytics returned `attempts` and `skipped` per row and
-- the client gated its verdicts on `attempts`. An accuracy's denominator is
-- ANSWERS -- rpc_record_question_attempt forces is_correct false on a skip, so
-- skips are excluded from the numerator and the denominator alike (§6.6) --
-- and the floor therefore measured the wrong quantity.
--
-- MEASURED on d1000003-0001 before this change, rendered verbatim on the
-- Subjects & Chapters tab:
--
--     Circles · Mathematics · Needs attention · 8 Attempts · 0% Accuracy
--
-- Circles is 8 attempts, 7 of them skipped. ONE question was answered and it
-- was wrong. The floor of 5 was cleared by seven skips. Three more chapters
-- carried the same kind of verdict: Statistics 8/3, Triangles 9/2, Some
-- Applications of Trigonometry 6/2.
--
-- The subject rows were already right, but only by accident: a subject whose
-- attempts are ALL skips has a null accuracy, so it fell out on the null check
-- rather than on the floor. Partial skipping still produces a number, which is
-- why the chapter and topic rows were wrong and the subject rows were not.
--
-- _weak_topics_for_user got this right already: its `practice` CTE filters
-- `AND NOT COALESCE(qa.skipped, false)`, so the column it calls `attempts` has
-- always held answers. This function is the one that let the two quantities
-- travel to the client under one name.
--
-- A SECOND QUANTITY WITH THE SAME PROBLEM: avg_sec averages over
-- `time_taken_ms > 0`, so a row's time can rest on a single reading while its
-- `attempts` says twenty. The slowest "topic" for this student was one attempt
-- of 579 seconds -- a tab left open, not a hard topic -- and it could not be
-- filtered out because the count of TIMED readings was never returned.
--
-- So each row now carries the denominator of every figure it reports:
--
--     attempts   every attempt, for "how much contact"
--     answered   attempts that were not skipped -- the accuracy denominator
--     timed      attempts with a recorded duration -- the avg_sec denominator
--
-- `skipped` stays. answered = attempts - skipped is true, but a client that
-- has to subtract to reach the denominator of the figure it is printing is one
-- refactor away from this defect again (G5: one quantity, one definition).
--
-- Nothing is removed and no existing key changes meaning, so a client built
-- against the previous shape keeps working.

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
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
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
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
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
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
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
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
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

-- Fail closed: every group must now carry its own denominators.
DO $guard$
DECLARE _src text := pg_get_functiondef('public.rpc_student_practice_analytics()'::regprocedure);
BEGIN
  IF (length(_src) - length(replace(_src, 'AS answered', ''))) / length('AS answered') <> 4 THEN
    RAISE EXCEPTION 'expected answered in all 4 grouped sections, got %',
      (length(_src) - length(replace(_src, 'AS answered', ''))) / length('AS answered');
  END IF;
  IF (length(_src) - length(replace(_src, 'AS timed', ''))) / length('AS timed') <> 4 THEN
    RAISE EXCEPTION 'expected timed in all 4 grouped sections, got %',
      (length(_src) - length(replace(_src, 'AS timed', ''))) / length('AS timed');
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261041000000_a_verdict_counts_the_answers_behind_it')
ON CONFLICT (version) DO NOTHING;
