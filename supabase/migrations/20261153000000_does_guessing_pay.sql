-- ═══════════════════════════════════════════════════════════════════════════
-- DOES GUESSING PAY, FOR THIS STUDENT (docs/TODO.md C3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- At +5/−1 a guess gains marks once more than one in six come out right. The
-- "I'm guessing" tap gives each student their own rate, and Analysis says
-- whether guessing pays for them, or to leave those questions blank.
--
-- rpc_student_practice_analytics gains `guesses`: the practice answers the
-- student marked as a guess (public._marked_as_guess, 20261152000000), how
-- many were answered and how many were right. A skip is not an answer, and an
-- attempt left out of accuracy is left out here too. The verdict — the rate
-- against the paper's break-even, and the floor before one is given — is the
-- app's (src/academic/metrics/guessing.ts), read against the paper the server
-- states (rpc_exam_paper), so no mark value is restated here.
--
-- Practice only, as all of Analysis is (analysisTabs.ts, rule 11). A mock
-- paper's guesses are read on that paper's own result.
--
-- The body is 20261151000000's (applied 2026-10-09), with `guesses` added and
-- nothing else changed.
--
-- ROLLBACK: rollback/20261153000000_does_guessing_pay.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

    -- ── by form (C1) ─────────────────────────────────────────────────────
    -- Every attempt under exactly one form, weakest first. The bank row says
    -- what a bank question is; an attempt with none is read from its own text.
    'by_form', (
      SELECT COALESCE(jsonb_agg(row_to_json(f) ORDER BY f.accuracy ASC NULLS LAST, f.attempts DESC), '[]'::jsonb)
      FROM (
        SELECT
          x.form                                                     AS form,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT x.skipped)::int                 AS answered,
          count(*) FILTER (WHERE x.time_ms > 0 AND NOT x.skipped)::int AS timed,
          count(*) FILTER (WHERE x.is_correct AND NOT x.skipped)::int AS correct,
          count(*) FILTER (WHERE x.skipped)::int                     AS skipped,
          round(100.0 * count(*) FILTER (WHERE x.is_correct AND NOT x.skipped)
                / NULLIF(count(*) FILTER (WHERE NOT x.skipped), 0), 1) AS accuracy,
          round(avg(x.time_ms) FILTER (WHERE x.time_ms > 0 AND NOT x.skipped) / 1000.0, 1) AS avg_sec
        FROM (
          SELECT COALESCE(qb.question_format,
                          public.question_form_of(COALESCE(qa.generated_question->>'question', ''),
                                                  COALESCE(qa.generated_question->'options', '[]'::jsonb))) AS form,
                 COALESCE(qa.skipped, false)      AS skipped,
                 qa.is_correct                    AS is_correct,
                 COALESCE(qa.time_taken_ms, 0)    AS time_ms
            FROM public.question_attempts qa
            LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
           WHERE qa.user_id = _uid
             AND NOT COALESCE(qa.excluded_from_accuracy, false)
        ) x
        GROUP BY x.form
      ) f
    ),

    -- ── guesses (C3) ─────────────────────────────────────────────────────
    -- The answers this student marked with "I'm guessing", and how many were
    -- right: their own rate, which Analysis reads against the paper's marking.
    'guesses', (
      SELECT jsonb_build_object(
        'answered', count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int,
        'correct',  count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int)
        FROM public.question_attempts qa
       WHERE qa.user_id = _uid
         AND NOT COALESCE(qa.excluded_from_accuracy, false)
         AND public._marked_as_guess(qa.confidence)
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

-- ── PROOF, as the caller, before COMMIT ─────────────────────────────────────
DO $proof$
DECLARE
  _uid    uuid;
  _school uuid;
  _r      jsonb;
  _r2     jsonb;
  _d      text;
  _q      jsonb := jsonb_build_object('question', 'A proof question.', 'options', jsonb_build_array('a', 'b', 'c', 'd'));
BEGIN
  SELECT qa.user_id INTO _uid FROM public.question_attempts qa GROUP BY qa.user_id ORDER BY count(*) DESC LIMIT 1;
  SELECT qa.school_id INTO _school FROM public.question_attempts qa WHERE qa.user_id = _uid LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;
  _r := public.rpc_student_practice_analytics();
  RESET ROLE;
  IF jsonb_typeof(_r->'guesses') IS DISTINCT FROM 'object'
     OR jsonb_typeof(_r->'guesses'->'answered') IS DISTINCT FROM 'number'
     OR jsonb_typeof(_r->'guesses'->'correct') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY FAILED: no guesses counts: %', _r->'guesses';
  END IF;

  -- Six attempts, undone by the raise that ends the block: right and guessed
  -- twice, wrong and guessed once, guessed and skipped once, right without
  -- the tap once, and guessed but left out of accuracy once. Only the first
  -- three are guesses answered: answered +3, correct +2.
  BEGIN
    INSERT INTO public.question_attempts (user_id, school_id, generated_question, correct_answer, is_correct, skipped, confidence, excluded_from_accuracy)
    VALUES
      (_uid, _school, _q, '{"index": 0}'::jsonb, true,  false, 0, false),
      (_uid, _school, _q, '{"index": 0}'::jsonb, true,  false, 0, false),
      (_uid, _school, _q, '{"index": 0}'::jsonb, false, false, 0, false),
      (_uid, _school, _q, '{"index": 0}'::jsonb, false, true,  0, false),
      (_uid, _school, _q, '{"index": 0}'::jsonb, true,  false, 1, false),
      (_uid, _school, _q, '{"index": 0}'::jsonb, false, false, 0, true);
    SET LOCAL ROLE authenticated;
    _r2 := public.rpc_student_practice_analytics();
    RESET ROLE;
    RAISE EXCEPTION 'proof-rollback' USING DETAIL = _r2::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS _d = PG_EXCEPTION_DETAIL;
    IF SQLERRM <> 'proof-rollback' THEN RAISE; END IF;
  END;
  _r2 := _d::jsonb;

  IF (_r2->'guesses'->>'answered')::int IS DISTINCT FROM (_r->'guesses'->>'answered')::int + 3
     OR (_r2->'guesses'->>'correct')::int IS DISTINCT FROM (_r->'guesses'->>'correct')::int + 2 THEN
    RAISE EXCEPTION 'VERIFY FAILED: guesses counted % then %, expected 3 answered and 2 right more', _r->'guesses', _r2->'guesses';
  END IF;
  -- CONTROL: the attempts did reach the other groups, so the guesses count was
  -- not read from a stale snapshot: four answered, one skipped, more by form.
  IF (SELECT sum((f->>'attempts')::int) FROM jsonb_array_elements(_r2->'by_form') f)
     IS DISTINCT FROM (SELECT sum((f->>'attempts')::int) FROM jsonb_array_elements(_r->'by_form') f) + 5 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the proof attempts did not reach by_form';
  END IF;
  IF EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.user_id = _uid AND qa.generated_question->>'question' = 'A proof question.') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the proof attempts survived';
  END IF;
END $proof$;

COMMIT;
