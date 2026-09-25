-- ===========================================================================
-- UPLOAD/CAPTURE-PRACTISED CHAPTERS ARE YOURS TO RECOVER
--
-- Binding: docs/custom-practice-upload-spec.md §12.2
--          KNOWN_ISSUES 58 (20261044000000 — entitlement follows practice)
--
-- Measured defect (2026-09-24, §12.2 as exam_cuet):
--   Accept MCQ paper tags to Business Studies / Nature and Significance of
--   Management. Student answers one wrong → mistake + upload attempt land.
--   _recovery_session_plan_for then raises:
--     "chapter … is not taught to this student's section"
--   because _recovery_chapter_is_for only admits (a) section_subjects or
--   (b) bank question_attempts joined to question_bank.chapter_id.
--   Upload/capture attempts have bank_question_id NULL and carry chapter_id
--   on generated_question / student_mistakes — so practising a private
--   original never entitled the chapter. KI58's ruling ("a chapter you
--   practised is yours") was incomplete for Custom Practice / screen capture.
--
-- Fix: also admit a chapter when this student has an attempt whose
-- generated_question.chapter_id is that chapter, or an open/cleared mistake
-- with that chapter_id (upload / screen_capture / bank).
--
-- ROLLBACK: rollback/20261082000000_upload_practised_chapters_are_yours_to_recover.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._recovery_chapter_is_for(_uid uuid, _chapter_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Taught to the student's own section...
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = _uid
  )
  -- ...or practised from the bank (20261044000000)...
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid
       AND qb.chapter_id = _chapter_id
  )
  -- ...or practised via a private upload / screen-capture attempt, which
  -- stamps chapter_id onto generated_question (§9 / §7.4) with no bank row.
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
     WHERE qa.user_id = _uid
       AND (qa.generated_question->>'chapter_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       AND (qa.generated_question->>'chapter_id')::uuid = _chapter_id
  )
  -- ...or has a mistake filed against that chapter (covers rows where the
  -- attempt snapshot omitted chapter_id but the mistake writer kept it).
  OR EXISTS (
    SELECT 1
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
  )
$function$;

COMMENT ON FUNCTION public._recovery_chapter_is_for(uuid, uuid) IS
  'Chapter entitlement for recovery/revision: taught to section, OR practised (bank attempt, upload/capture attempt via generated_question.chapter_id, or mistake.chapter_id). KI58 + §12.2.';

-- ── Verify ─────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _src text;
  _uid uuid;
  _sid uuid;
  _school uuid;
  _chap uuid;
  _mid uuid;
  _aid uuid;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_recovery_chapter_is_for';
  IF position('generated_question->>''chapter_id''' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: _recovery_chapter_is_for ignores generated_question.chapter_id';
  END IF;
  IF position('sm.chapter_id = _chapter_id' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: _recovery_chapter_is_for ignores student_mistakes.chapter_id';
  END IF;

  -- Positive control: a chapter neither taught nor bank-practised becomes
  -- entitled after an upload-shaped attempt stamps chapter_id.
  SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  SELECT c.id INTO _chap
    FROM public.chapters c
   WHERE NOT public._recovery_chapter_is_for(_uid, c.id)
   LIMIT 1;

  IF _uid IS NULL OR _chap IS NULL THEN
    RAISE WARNING 'no untaught chapter fixture; body markers verified only';
    RETURN;
  END IF;

  INSERT INTO public.question_attempts (
    user_id, student_id, school_id, generated_question, correct_answer,
    score, is_correct, skipped, source
  ) VALUES (
    _uid, _sid, _school,
    jsonb_build_object('chapter_id', _chap::text, 'question', '__probe_820__'),
    '{}'::jsonb, 0, false, false, 'upload'
  )
  RETURNING id INTO _aid;

  IF NOT public._recovery_chapter_is_for(_uid, _chap) THEN
    DELETE FROM public.question_attempts WHERE id = _aid;
    RAISE EXCEPTION 'VERIFY FAILED: upload attempt did not entitle chapter %', _chap;
  END IF;

  DELETE FROM public.question_attempts WHERE id = _aid;

  -- And mistake.chapter_id alone also entitles (no attempt).
  IF public._recovery_chapter_is_for(_uid, _chap) THEN
    RAISE EXCEPTION 'VERIFY FAILED: chapter still entitled after attempt deleted';
  END IF;

  INSERT INTO public.student_mistakes (
    user_id, student_id, school_id, source, subject, question_text, chapter_id, status
  ) VALUES (
    _uid, _sid, _school, 'upload', '__probe_820__', '__probe_820__', _chap, 'open'
  )
  RETURNING id INTO _mid;

  IF NOT public._recovery_chapter_is_for(_uid, _chap) THEN
    DELETE FROM public.student_mistakes WHERE id = _mid;
    RAISE EXCEPTION 'VERIFY FAILED: mistake.chapter_id did not entitle chapter %', _chap;
  END IF;

  DELETE FROM public.student_mistakes WHERE id = _mid;
END
$verify$;

COMMIT;
