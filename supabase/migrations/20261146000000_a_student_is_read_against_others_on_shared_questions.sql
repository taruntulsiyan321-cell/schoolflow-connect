-- ═══════════════════════════════════════════════════════════════════════════
-- A STUDENT IS READ AGAINST OTHERS, ON THE QUESTIONS THEY SHARE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-03 (approved analysis, 3c — "peer comparison, thresholded"):
-- on the questions a student has answered, how often other students preparing
-- for the same exam got them right FIRST TIME, against how often they did.
--
-- rpc_student_peer_comparison() returns, by subject, sums over the questions
-- the caller has answered that at least MIN_STUDENTS other students preparing
-- for the same exam (exam_accounts.exam_id) have answered too:
--   questions     how many such questions
--   mine_right    how many of them the caller got right first time
--   peer_answers  other students' first answers to them
--   peer_right    how many of those were right
-- First time: each student's earliest answer to a question (not skipped, not
-- timed out, not left out of accuracy).
--
-- PRIVACY. Only sums over questions with at least MIN_STUDENTS other students
-- behind each are returned — never one question's figure, never a student. The
-- floor is stated ONCE, here, and returned with the reply so the screen can
-- say it; a client cannot lower it.
--
-- It reads other students' answers by design (to aggregate them), so it is a
-- SECURITY DEFINER read across tenants of one; it writes nothing.
--
-- ROLLBACK: rollback/20261146000000_a_student_is_read_against_others_on_shared_questions.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.rpc_student_peer_comparison()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid  uuid := auth.uid();
  -- The privacy floor: a question is compared only when at least this many
  -- OTHER students preparing for the same exam have answered it.
  _min_students constant int := 5;
  _exam uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  SELECT ea.exam_id INTO _exam
    FROM public.exam_accounts ea
   WHERE ea.account_id = _uid
   ORDER BY ea.created_at
   LIMIT 1;

  RETURN jsonb_build_object(
    'exam_found',   _exam IS NOT NULL,
    'min_students', _min_students,
    'subjects', COALESCE((
      WITH mine AS (
        SELECT DISTINCT ON (qa.bank_question_id) qa.bank_question_id, COALESCE(qa.is_correct, false) AS right_first
          FROM public.question_attempts qa
         WHERE qa.user_id = _uid
           AND qa.bank_question_id IS NOT NULL
           AND NOT COALESCE(qa.skipped, false)
           AND NOT COALESCE(qa.timed_out, false)
           AND NOT COALESCE(qa.excluded_from_accuracy, false)
         ORDER BY qa.bank_question_id, qa.created_at, qa.id
      ), theirs AS (
        SELECT DISTINCT ON (qa.user_id, qa.bank_question_id)
               qa.user_id, qa.bank_question_id, COALESCE(qa.is_correct, false) AS right_first
          FROM public.question_attempts qa
          JOIN public.exam_accounts ea ON ea.account_id = qa.user_id AND ea.exam_id = _exam
          JOIN mine m ON m.bank_question_id = qa.bank_question_id
         WHERE qa.user_id <> _uid
           AND NOT COALESCE(qa.skipped, false)
           AND NOT COALESCE(qa.timed_out, false)
           AND NOT COALESCE(qa.excluded_from_accuracy, false)
         ORDER BY qa.user_id, qa.bank_question_id, qa.created_at, qa.id
      ), shared AS (
        SELECT t.bank_question_id,
               count(*)::int                                AS students,
               count(*) FILTER (WHERE t.right_first)::int   AS right_first
          FROM theirs t
         GROUP BY t.bank_question_id
        HAVING count(*) >= _min_students
      )
      SELECT jsonb_agg(jsonb_build_object(
               'subject', x.subject, 'questions', x.questions, 'mine_right', x.mine_right,
               'peer_answers', x.peer_answers, 'peer_right', x.peer_right) ORDER BY x.subject)
        FROM (
          SELECT cs.name                                   AS subject,
                 count(*)::int                             AS questions,
                 count(*) FILTER (WHERE m.right_first)::int AS mine_right,
                 sum(s.students)::int                      AS peer_answers,
                 sum(s.right_first)::int                   AS peer_right
            FROM shared s
            JOIN mine m ON m.bank_question_id = s.bank_question_id
            JOIN public.question_bank qb ON qb.id = s.bank_question_id
            JOIN public.chapters c ON c.id = qb.chapter_id
            JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
           GROUP BY cs.name
        ) x), '[]'::jsonb));
END $fn$;

REVOKE ALL ON FUNCTION public.rpc_student_peer_comparison() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_student_peer_comparison() TO authenticated;

COMMENT ON FUNCTION public.rpc_student_peer_comparison() IS
  'By subject, sums over the caller''s questions answered by at least 5 other students of the same exam: their first-time right against the caller''s (20261146000000). No single question or student is returned.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.rpc_student_peer_comparison()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_student_peer_comparison()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the comparison is shut to students or open to strangers';
  END IF;
END $verify$;

-- ── PROOF: a student, five peers, a stranger; rolled back ──────────────────
DO $proof$
DECLARE
  _fail text := '';
  _sentinel constant text := 'm20261146 proof rolled back';
  _a uuid; _a_school uuid; _exam uuid; _stream text;
  _q1 uuid; _q2 uuid; _subject text;
  _peers uuid[]; _peer_schools uuid[]; _stranger uuid; _stranger_school uuid;
  _school uuid; _sess uuid; _i int;
  _r jsonb; _row jsonb;
BEGIN
  SELECT ea.account_id, st.school_id, ea.exam_id, ea.stream INTO _a, _a_school, _exam, _stream
    FROM public.exam_accounts ea JOIN public.students st ON st.user_id = ea.account_id
   ORDER BY ea.account_id LIMIT 1;
  -- Two questions of one subject that nobody has answered, so the fixture is all there is.
  SELECT qb.id, cs.name INTO _q1, _subject
    FROM public.question_bank qb
    JOIN public.chapters c ON c.id = qb.chapter_id
    JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
   WHERE NOT EXISTS (SELECT 1 FROM public.question_attempts x WHERE x.bank_question_id = qb.id)
   ORDER BY qb.id LIMIT 1;
  SELECT qb.id INTO _q2
    FROM public.question_bank qb
    JOIN public.chapters c ON c.id = qb.chapter_id
    JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id AND cs.name = _subject
   WHERE qb.id <> _q1 AND NOT EXISTS (SELECT 1 FROM public.question_attempts x WHERE x.bank_question_id = qb.id)
   ORDER BY qb.id LIMIT 1;
  -- Six real students with no exam of their own: five become peers, one stays a stranger.
  SELECT array_agg(u ORDER BY u) INTO _peers FROM (
    SELECT DISTINCT st.user_id AS u FROM public.students st JOIN public.accounts acc ON acc.id = st.user_id
     WHERE st.user_id IS NOT NULL AND st.user_id <> _a
       AND NOT EXISTS (SELECT 1 FROM public.exam_accounts e WHERE e.account_id = st.user_id)
     ORDER BY st.user_id LIMIT 6) p;
  IF _a IS NULL OR _q1 IS NULL OR _q2 IS NULL OR coalesce(array_length(_peers, 1), 0) < 6 THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (a % q1 % q2 % students %)', _a, _q1, _q2, coalesce(array_length(_peers, 1), 0);
  END IF;
  _stranger := _peers[6];
  _peers := _peers[1:5];
  SELECT st.school_id INTO _stranger_school FROM public.students st WHERE st.user_id = _stranger LIMIT 1;

  BEGIN
    -- The peers: an exam account each, on a school of their own (one per school).
    _peer_schools := ARRAY[]::uuid[];
    FOR _i IN 1..5 LOOP
      INSERT INTO public.schools (name) VALUES ('Probe 20261146 peer ' || _i) RETURNING id INTO _school;
      INSERT INTO public.exam_accounts (school_id, exam_id, account_id, stream) VALUES (_school, _exam, _peers[_i], _stream);
      _peer_schools := _peer_schools || _school;
    END LOOP;

    -- The student: right first time on q1 (wrong later), wrong on q2.
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at)
      VALUES (_a, _a_school, 'Probe 20261146', 'Probe', 3, now()) RETURNING id INTO _sess;
    INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at) VALUES
      (_a, _a_school, _sess, _q1, '{}', '{}', true,  false, now() - interval '2 hours'),
      (_a, _a_school, _sess, _q1, '{}', '{}', false, false, now() - interval '1 hour'),
      (_a, _a_school, _sess, _q2, '{}', '{}', false, false, now() - interval '2 hours');
    -- The peers on q1, first tries: wrong (then right), right, right, wrong, right → 3 of 5.
    -- On q2 only four of them answer: under the floor, never compared.
    FOR _i IN 1..5 LOOP
      INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at)
        VALUES (_peers[_i], _peer_schools[_i], 'Probe 20261146', 'Probe', 2, now()) RETURNING id INTO _sess;
      INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at)
        VALUES (_peers[_i], _peer_schools[_i], _sess, _q1, '{}', '{}', _i IN (2, 3, 5), false, now() - interval '3 hours');
      IF _i = 1 THEN
        INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at)
          VALUES (_peers[_i], _peer_schools[_i], _sess, _q1, '{}', '{}', true, false, now() - interval '1 hour');
      END IF;
      IF _i <= 4 THEN
        INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at)
          VALUES (_peers[_i], _peer_schools[_i], _sess, _q2, '{}', '{}', true, false, now() - interval '3 hours');
      END IF;
    END LOOP;
    -- A stranger (no exam) right on q1: not a peer, not counted.
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at)
      VALUES (_stranger, _stranger_school, 'Probe 20261146', 'Probe', 1, now()) RETURNING id INTO _sess;
    INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at)
      VALUES (_stranger, _stranger_school, _sess, _q1, '{}', '{}', true, false, now() - interval '3 hours');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_student_peer_comparison();
    EXECUTE 'RESET ROLE';
    SELECT s INTO _row FROM jsonb_array_elements(_r->'subjects') s WHERE s->>'subject' = _subject;

    -- 1. q1 only: the caller right first time; the peers 3 right of 5 first answers.
    IF _row IS NULL
       OR (_row->>'questions')::int <> 1
       OR (_row->>'mine_right')::int <> 1
       OR (_row->>'peer_answers')::int <> 5
       OR (_row->>'peer_right')::int <> 3 THEN
      _fail := _fail || ' [1 ' || coalesce(_row::text, 'no row') || ']';
    END IF;
    -- 2. The floor is said, and is the one applied.
    IF (_r->>'min_students')::int <> 5 OR (_r->>'exam_found')::boolean IS NOT TRUE THEN
      _fail := _fail || ' [2 ' || _r::text || ']';
    END IF;
    -- 3. Refusals.
    PERFORM set_config('request.jwt.claims', NULL, true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.rpc_student_peer_comparison();
      _fail := _fail || ' [3 a stranger read a comparison]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.rpc_student_peer_comparison();
      _fail := _fail || ' [3 read with no identity]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'auth required' THEN _fail := _fail || ' [3 ' || SQLERRM || ']'; END IF;
    END;
    EXECUTE 'RESET ROLE';

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
