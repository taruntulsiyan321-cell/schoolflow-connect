-- ===========================================================================
-- REVISION: CLEAR UNTAGGED POISON + TALLY TAGGED CAPTURES
--
-- Binding: docs/custom-practice-upload-spec.md §5.1
--          docs/recovery-revision-analysis-spec.md §5.2 (engagement clock)
--          docs/screen-capture-mistakes-spec.md §7.4
--          Follows 20261079000000_untagged_mistakes_skip_revision
--
-- 790 stops NEW untagged screen_capture / upload mistakes from writing
-- revision_queue / concept_mastery. Two leftovers remain:
--
--   1. Rows already written by 770 (subject '', null chapter, reason
--      screen_capture_wrong / upload_wrong) stay in revision_queue and can
--      still feed EIE / recommendation "revision" seeds.
--   2. _write_chapter_tally (690) never joined student_capture_questions, so
--      practising a TAGGED capture never contributes to chapter_tally and the
--      §5.2 engagement clock never starts — while untagged correctly still
--      produce zero rows (chapter_id IS NULL).
--
-- Fix: delete poison that has no matching tagged private mistake; resolve
-- capture attempts the same way uploads are resolved. Untagged stay out.
--
-- ROLLBACK: rollback/20261080100000_revision_untagged_poison_and_capture_tally.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Poison cleanup ───────────────────────────────────────────────────────
-- Keep a row only when an open tagged (chapter_id IS NOT NULL) upload/capture
-- mistake still matches its subject+chapter labels. Everything else with those
-- reasons was untagged seeding or an orphan after the chapter was cleared.
DELETE FROM public.revision_queue rq
 WHERE rq.reason IN ('upload_wrong', 'screen_capture_wrong')
   AND NOT EXISTS (
     SELECT 1
       FROM public.student_mistakes sm
      WHERE sm.user_id = rq.user_id
        AND sm.source IN ('upload', 'screen_capture')
        AND sm.chapter_id IS NOT NULL
        AND sm.status = 'open'
        AND sm.subject IS NOT DISTINCT FROM rq.subject
        AND COALESCE(sm.chapter, '') = COALESCE(rq.chapter, '')
   );

-- ── 2. chapter_tally resolves tagged capture originals ──────────────────────
CREATE OR REPLACE FUNCTION public._write_chapter_tally(_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  -- One row per DISTINCT chapter in the session. chapter_id from, in order:
  --   1. question_bank.chapter_id
  --   2. generated_question.chapter_id when it EXISTS in public.chapters
  --   3. student_upload_questions.chapter_id
  --   4. student_capture_questions.chapter_id
  -- Untagged private rows (null chapter_id) still do not tally.
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
    LEFT JOIN public.student_capture_questions scq
      ON (qa.generated_question->>'capture_question_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND scq.id = (qa.generated_question->>'capture_question_id')::uuid
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
        suq.chapter_id,
        scq.chapter_id
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

REVOKE ALL ON FUNCTION public._write_chapter_tally(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._write_chapter_tally(uuid) IS
  '§3.1 denominator. Bank / generated_question.chapter_id (must exist in chapters) / student_upload_questions / student_capture_questions. Never invents chapters; untagged private rows do not tally.';

-- ── 3. VERIFY (must be able to fail) ────────────────────────────────────────
DO $prove$
DECLARE
  _src text;
  _uid uuid;
  _sid uuid;
  _school uuid;
  _chap uuid;
  _cap uuid;
  _sess uuid;
  _rows int;
  _n int;
BEGIN
  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_write_chapter_tally';

  IF _src IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: _write_chapter_tally missing';
  END IF;
  IF position('student_capture_questions' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: tally still ignores student_capture_questions';
  END IF;
  IF position('capture_question_id' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: tally does not resolve capture_question_id';
  END IF;
  IF position('resolved.chapter_id IS NOT NULL' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: untagged (null chapter_id) gate missing on tally';
  END IF;

  -- Gate on 790 still present (positive control that this migration did not
  -- rewrite the mistake writer back to always-seed).
  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_concept_mistake'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%_capture_question_id%';
  IF _src IS NULL OR position('IF _chapter_id IS NOT NULL THEN' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: 790 untagged chapter_id gate missing on rpc_record_concept_mistake';
  END IF;

  SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  SELECT c.id INTO _chap FROM public.chapters c LIMIT 1;

  IF _uid IS NULL OR _chap IS NULL THEN
    RAISE WARNING 'no student/chapter to probe capture tally; body shape verified only';
    RETURN;
  END IF;

  IF to_regclass('public.student_capture_questions') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_capture_questions missing (770)';
  END IF;

  INSERT INTO public.student_capture_questions (
    owner_id, school_id, fingerprint, question_text, options, correct_index,
    answer_source, chapter_id
  ) VALUES (
    _uid, _school, '__probe_cap_tally__' || gen_random_uuid()::text,
    '__probe capture tally__', '["a","b"]'::jsonb, 0, 'screen', _chap
  ) RETURNING id INTO _cap;

  INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, question_count)
  VALUES (_uid, _sid, _school, '__probe_capture_tally__', 1)
  RETURNING id INTO _sess;

  INSERT INTO public.question_attempts (
    user_id, student_id, school_id, session_id, bank_question_id, source,
    is_correct, score, generated_question, correct_answer, selected_answer
  ) VALUES (
    _uid, _sid, _school, _sess, NULL, 'screen_capture',
    true, 1,
    jsonb_build_object('capture_question_id', _cap::text, 'question', '__probe__'),
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
    DELETE FROM public.student_capture_questions WHERE id = _cap;
    RAISE EXCEPTION
      'VERIFY FAILED: tagged capture attempt produced % tally row(s), expected 1 (write returned %)',
      _n, _rows;
  END IF;

  -- Negative: untagged capture (null chapter_id on private row) must not tally.
  DELETE FROM public.chapter_tally WHERE session_id = _sess;
  DELETE FROM public.question_attempts WHERE session_id = _sess;
  UPDATE public.student_capture_questions SET chapter_id = NULL WHERE id = _cap;

  INSERT INTO public.question_attempts (
    user_id, student_id, school_id, session_id, bank_question_id, source,
    is_correct, score, generated_question, correct_answer, selected_answer
  ) VALUES (
    _uid, _sid, _school, _sess, NULL, 'screen_capture',
    false, 0,
    jsonb_build_object('capture_question_id', _cap::text, 'question', '__probe_untagged__'),
    '"a"'::jsonb, '"a"'::jsonb
  );

  SELECT public._write_chapter_tally(_sess) INTO _rows;
  SELECT count(*)::int INTO _n FROM public.chapter_tally WHERE session_id = _sess;

  IF _n <> 0 THEN
    DELETE FROM public.chapter_tally WHERE session_id = _sess;
    DELETE FROM public.question_attempts WHERE session_id = _sess;
    DELETE FROM public.practice_sessions WHERE id = _sess;
    DELETE FROM public.student_capture_questions WHERE id = _cap;
    RAISE EXCEPTION
      'VERIFY FAILED: untagged capture produced % tally row(s) (must be 0; write returned %)',
      _n, _rows;
  END IF;

  DELETE FROM public.question_attempts WHERE session_id = _sess;
  DELETE FROM public.practice_sessions WHERE id = _sess;
  DELETE FROM public.student_capture_questions WHERE id = _cap;
END;
$prove$;

COMMIT;
