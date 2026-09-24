-- ===========================================================================
-- UPLOAD ATTEMPTS TALLY BY REAL CHAPTER_ID
--
-- Binding: docs/custom-practice-upload-spec.md §9 / recovery §3.1 denominator
--
-- Measured defect (sync audit a6c7f65b):
--   _write_chapter_tally only JOINs question_bank on bank_question_id.
--   Upload attempts have bank_question_id NULL and source='upload', so a
--   finished upload session writes zero chapter_tally rows even when
--   generated_question.chapter_id (or student_upload_questions.chapter_id)
--   names a real chapters.id. Recovery/revision denominators stay empty.
--
-- Fix: resolve chapter_id from, in order:
--   1. question_bank.chapter_id (unchanged bank path)
--   2. generated_question->>'chapter_id' when it is a uuid that EXISTS in
--      public.chapters (never invent a chapter)
--   3. student_upload_questions.chapter_id via
--      generated_question->>'upload_question_id'
-- Untagged upload rows (no real chapter_id) still do not tally.
--
-- ROLLBACK: rollback/20261069000000_upload_chapter_tally.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._write_chapter_tally(_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  -- One row per DISTINCT chapter in the session. The grain is the whole point:
  -- per-question storage is what this table exists to make unnecessary, and a
  -- per-question row would also be per-question correctness, which §10.8
  -- forbids for practice.
  --
  -- chapter_id comes from the bank, or from a real chapters.id carried on an
  -- upload attempt — never from a free-text chapter label, and never invented.
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  SELECT ps.user_id, ps.student_id, ps.school_id, resolved.chapter_id, ps.id,
         count(*)::int,
         count(*) FILTER (WHERE qa.is_correct IS TRUE)::int
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    LEFT JOIN public.student_upload_questions suq
      ON (qa.generated_question->>'upload_question_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND suq.id = (qa.generated_question->>'upload_question_id')::uuid
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        qb.chapter_id,
        CASE
          WHEN (qa.generated_question->>'chapter_id') ~
                 '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           AND EXISTS (
             SELECT 1 FROM public.chapters c
              WHERE c.id = (qa.generated_question->>'chapter_id')::uuid
           )
          THEN (qa.generated_question->>'chapter_id')::uuid
          ELSE NULL
        END,
        suq.chapter_id
      ) AS chapter_id
    ) resolved
   WHERE qa.session_id = _session_id
     AND resolved.chapter_id IS NOT NULL
   GROUP BY ps.user_id, ps.student_id, ps.school_id, resolved.chapter_id, ps.id
  ON CONFLICT (session_id, chapter_id) DO UPDATE
    SET attempted = EXCLUDED.attempted,
        correct   = EXCLUDED.correct;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

-- Internal: called by rpc_finish_practice_session, never by a client.
REVOKE ALL ON FUNCTION public._write_chapter_tally(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._write_chapter_tally(uuid) IS
  '§3.1 denominator. Bank attempts via question_bank.chapter_id; upload attempts via generated_question.chapter_id (must exist in chapters) or student_upload_questions.chapter_id. Never invents chapters.';

-- ── VERIFY (must be able to fail) ───────────────────────────────────────────
DO $prove$
DECLARE
  _src text;
  _uid uuid;
  _sid uuid;
  _school uuid;
  _chap uuid;
  _sess uuid;
  _rows int;
  _n int;
  _fake uuid := '00000000-0000-4000-8000-ffffffffffff';
BEGIN
  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_write_chapter_tally';

  IF _src IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: _write_chapter_tally missing';
  END IF;
  IF position('generated_question' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: tally still ignores generated_question.chapter_id';
  END IF;
  IF position('student_upload_questions' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: tally does not join student_upload_questions';
  END IF;
  IF position('LEFT JOIN public.question_bank' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: tally still INNER-JOINs question_bank only (upload path dead)';
  END IF;
  -- Positive control: body must refuse to invent chapters (EXISTS against chapters).
  IF position('FROM public.chapters' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: tally does not verify chapter_id against chapters';
  END IF;

  SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  SELECT c.id INTO _chap FROM public.chapters c LIMIT 1;

  IF _uid IS NULL OR _chap IS NULL THEN
    RAISE WARNING 'no student/chapter to probe; body shape verified only';
    RETURN;
  END IF;

  -- Positive control: upload attempt, bank_question_id null, real chapter_id
  -- in generated_question → one tally row.
  INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, question_count)
  VALUES (_uid, _sid, _school, '__probe_upload_tally__', 1)
  RETURNING id INTO _sess;

  INSERT INTO public.question_attempts (
    user_id, student_id, school_id, session_id, bank_question_id, source,
    is_correct, score, generated_question, correct_answer, selected_answer
  ) VALUES (
    _uid, _sid, _school, _sess, NULL, 'upload',
    true, 1,
    jsonb_build_object('chapter_id', _chap::text, 'question', '__probe__'),
    '"a"'::jsonb, '"a"'::jsonb
  );

  SELECT public._write_chapter_tally(_sess) INTO _rows;
  SELECT count(*)::int INTO _n
    FROM public.chapter_tally
   WHERE session_id = _sess AND chapter_id = _chap;

  IF _n <> 1 THEN
    DELETE FROM public.chapter_tally WHERE session_id = _sess;
    DELETE FROM public.question_attempts WHERE session_id = _sess;
    DELETE FROM public.practice_sessions WHERE id = _sess;
    RAISE EXCEPTION
      'VERIFY FAILED: upload attempt with real chapter_id produced % tally row(s), expected 1 (write returned %)',
      _n, _rows;
  END IF;

  -- Negative control: fake chapter_id must NOT invent a chapters row or tally.
  DELETE FROM public.chapter_tally WHERE session_id = _sess;
  DELETE FROM public.question_attempts WHERE session_id = _sess;

  INSERT INTO public.question_attempts (
    user_id, student_id, school_id, session_id, bank_question_id, source,
    is_correct, score, generated_question, correct_answer, selected_answer
  ) VALUES (
    _uid, _sid, _school, _sess, NULL, 'upload',
    false, 0,
    jsonb_build_object('chapter_id', _fake::text, 'question', '__probe_fake__'),
    '"a"'::jsonb, '"a"'::jsonb
  );

  SELECT public._write_chapter_tally(_sess) INTO _rows;
  SELECT count(*)::int INTO _n FROM public.chapter_tally WHERE session_id = _sess;

  IF _n <> 0 THEN
    DELETE FROM public.chapter_tally WHERE session_id = _sess;
    DELETE FROM public.question_attempts WHERE session_id = _sess;
    DELETE FROM public.practice_sessions WHERE id = _sess;
    RAISE EXCEPTION
      'VERIFY FAILED: fake chapter_id invented % tally row(s) (must be 0; write returned %)',
      _n, _rows;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chapters WHERE id = _fake) THEN
    RAISE EXCEPTION 'VERIFY FAILED: fake chapter_id was inserted into chapters';
  END IF;

  DELETE FROM public.question_attempts WHERE session_id = _sess;
  DELETE FROM public.practice_sessions WHERE id = _sess;
END $prove$;

COMMIT;
