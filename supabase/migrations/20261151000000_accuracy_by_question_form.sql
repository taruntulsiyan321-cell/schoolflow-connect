-- ═══════════════════════════════════════════════════════════════════════════
-- ACCURACY BY KIND OF QUESTION, ACROSS ALL PRACTICE (docs/TODO.md C1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "70% on direct questions, 30% on assertion–reason" — the most actionable
-- CUET figure not yet shown. A session's result already breaks its own answers
-- down by form; this is the whole history, on Analysis.
--
-- rpc_student_practice_analytics gains `by_form`: the same counts and the same
-- denominators as by_subject, by_chapter and by_difficulty, grouped by the
-- form of the question answered, weakest first. It is one more dimension of
-- the read Analysis already makes, not a second read.
--
-- WHAT FORM AN ATTEMPT WAS. The bank row's question_format when the attempt
-- names one: since 20261141000000 a trigger keeps it equal to the form its
-- text is laid out in, and the rows imported before then were re-laid, so a
-- match question whose lists had been pushed into its options is a match
-- question, though the copy the attempt kept is not laid out as one. An
-- attempt with no bank row (AI-written practice before it reached the bank,
-- a student's own upload) is read from its own copy of the text by
-- question_form_of, the SQL twin of questionForms.ts's formOf.
--
-- Measured 2026-10-09 across every attempt: 3,611 on direct bank questions,
-- 33 on the other forms, 4,812 with no bank row.
--
-- Not locked by the plan: topic-wise analysis is what the plan sells
-- (20261112000000), and a form is not a topic — by_difficulty is not locked
-- either.
--
-- The body is the live one (read 2026-10-09 with pg_get_functiondef), with
-- by_form added and nothing else changed.
--
-- ROLLBACK: rollback/20261151000000_accuracy_by_question_form.rollback.sql
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
  _att    int;
  _ans    int;
  _cor    int;
  _match  uuid;
  _f      jsonb;
  _f2     jsonb;
BEGIN
  -- The student with the most practice.
  SELECT qa.user_id INTO _uid FROM public.question_attempts qa GROUP BY qa.user_id ORDER BY count(*) DESC LIMIT 1;
  SELECT qa.school_id INTO _school FROM public.question_attempts qa WHERE qa.user_id = _uid LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;
  _r := public.rpc_student_practice_analytics();
  RESET ROLE;

  -- 1. Every attempt counted once, under exactly one named form, with the
  --    denominators every other group carries.
  SELECT count(*), count(*) FILTER (WHERE NOT qa.skipped), count(*) FILTER (WHERE qa.is_correct AND NOT qa.skipped)
    INTO _att, _ans, _cor
    FROM public.question_attempts qa
   WHERE qa.user_id = _uid AND NOT qa.excluded_from_accuracy;
  -- IS DISTINCT FROM throughout: a missing by_form is NULL, and NULL <> x is
  -- never true, so a plain comparison would let its absence pass.
  IF jsonb_typeof(_r->'by_form') IS DISTINCT FROM 'array' OR jsonb_array_length(_r->'by_form') = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: no by_form for a student with % attempts', _att;
  END IF;
  IF (SELECT sum((f->>'attempts')::int) FROM jsonb_array_elements(_r->'by_form') f) IS DISTINCT FROM _att::bigint
     OR (SELECT sum((f->>'answered')::int) FROM jsonb_array_elements(_r->'by_form') f) IS DISTINCT FROM _ans::bigint
     OR (SELECT sum((f->>'correct')::int) FROM jsonb_array_elements(_r->'by_form') f) IS DISTINCT FROM _cor::bigint THEN
    RAISE EXCEPTION 'VERIFY FAILED: by_form does not add up to the % attempts, % answered, % right: %', _att, _ans, _cor, _r->'by_form';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_r->'by_form') f
              WHERE f->>'form' IS NULL OR NOT (f ? 'attempts' AND f ? 'answered' AND f ? 'timed')) THEN
    RAISE EXCEPTION 'VERIFY FAILED: a form row is unnamed or lacks its denominators: %', _r->'by_form';
  END IF;
  IF (SELECT count(DISTINCT f->>'form') FROM jsonb_array_elements(_r->'by_form') f) <> jsonb_array_length(_r->'by_form') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a form appears twice: %', _r->'by_form';
  END IF;

  -- 2. Which form an attempt is. Two attempts, undone by the raise that ends
  --    the block: one with no bank row, its text an assertion–reason question,
  --    answered wrong; one on a bank match question whose copy of the text is
  --    plain, answered right. The first must count as assertion–reason (read
  --    from its text), the second as match (read from the bank, not the copy).
  SELECT qb.id INTO _match FROM public.question_bank qb WHERE qb.question_format = 'match' LIMIT 1;
  IF _match IS NULL THEN RAISE EXCEPTION 'VERIFY FAILED: no match question in the bank to prove with'; END IF;
  BEGIN
    INSERT INTO public.question_attempts (user_id, school_id, generated_question, correct_answer, is_correct, skipped, time_taken_ms)
    VALUES
      (_uid, _school,
       jsonb_build_object('question', E'Assertion (A): Proof assertion.\nReason (R): Proof reason.',
                          'options', jsonb_build_array('Both true', 'A only', 'R only', 'Neither')),
       '{"index": 0}'::jsonb, false, false, 9000);
    INSERT INTO public.question_attempts (user_id, school_id, generated_question, correct_answer, is_correct, skipped, time_taken_ms, bank_question_id)
    VALUES
      (_uid, _school,
       jsonb_build_object('question', 'A plain copy of a match question.', 'options', jsonb_build_array('p', 'q', 'r', 's')),
       '{"index": 0}'::jsonb, true, false, 9000, _match);
    SET LOCAL ROLE authenticated;
    _r2 := public.rpc_student_practice_analytics();
    RESET ROLE;
    RAISE EXCEPTION 'proof-rollback' USING DETAIL = _r2::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS _d = PG_EXCEPTION_DETAIL;
    IF SQLERRM <> 'proof-rollback' THEN RAISE; END IF;
  END;
  _r2 := _d::jsonb;

  SELECT f INTO _f  FROM jsonb_array_elements(_r->'by_form')  f WHERE f->>'form' = 'assertion_reason';
  SELECT f INTO _f2 FROM jsonb_array_elements(_r2->'by_form') f WHERE f->>'form' = 'assertion_reason';
  IF COALESCE((_f2->>'attempts')::int, 0) <> COALESCE((_f->>'attempts')::int, 0) + 1
     OR COALESCE((_f2->>'correct')::int, 0) <> COALESCE((_f->>'correct')::int, 0) THEN
    RAISE EXCEPTION 'VERIFY FAILED: an assertion–reason text with no bank row was not read as one: before %, after %', _f, _f2;
  END IF;
  SELECT f INTO _f  FROM jsonb_array_elements(_r->'by_form')  f WHERE f->>'form' = 'match';
  SELECT f INTO _f2 FROM jsonb_array_elements(_r2->'by_form') f WHERE f->>'form' = 'match';
  IF COALESCE((_f2->>'attempts')::int, 0) <> COALESCE((_f->>'attempts')::int, 0) + 1
     OR COALESCE((_f2->>'correct')::int, 0) <> COALESCE((_f->>'correct')::int, 0) + 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: a bank match question was not read as one: before %, after %', _f, _f2;
  END IF;
  -- CONTROL: the direct-question row did not move, so the two did not land there.
  SELECT f INTO _f  FROM jsonb_array_elements(_r->'by_form')  f WHERE f->>'form' = 'mcq';
  SELECT f INTO _f2 FROM jsonb_array_elements(_r2->'by_form') f WHERE f->>'form' = 'mcq';
  IF _f IS DISTINCT FROM _f2 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the direct-question row moved: before %, after %', _f, _f2;
  END IF;
  -- And the proof's two attempts are gone.
  IF EXISTS (SELECT 1 FROM public.question_attempts qa
              WHERE qa.user_id = _uid AND qa.generated_question->>'question' IN
                    (E'Assertion (A): Proof assertion.\nReason (R): Proof reason.', 'A plain copy of a match question.')) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the proof attempts survived';
  END IF;

  -- 3. The caller's own and nobody else's: anon may not call it.
  IF has_function_privilege('anon', 'public.rpc_student_practice_analytics()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: anon can call rpc_student_practice_analytics';
  END IF;
END $proof$;

COMMIT;
