-- ROLLBACK 20261115000000 — takes mock tests out, and puts the practice
-- catalog back exactly as 20261110000000 wrote it.
--
-- THIS DESTROYS DATA: every mock paper sat and every answer on it. There is no
-- way to keep them — the tables that hold them are the thing being removed —
-- so it says how many before it does it, and refuses unless it is told to go
-- ahead when there are any:
--
--   SET gurukul.drop_mock_papers = 'yes';    -- same session, before this file
--
-- Nothing else is lost. The mistakes the papers wrote are ordinary Mistake Book
-- rows (source 'practice') and are LEFT ALONE: the student really did get those
-- questions wrong, and deleting them would take away work they have done
-- towards clearing them. Their source_id will point at an attempt that no
-- longer exists, which is already true of every mistake whose practice session
-- has been pruned.
--
-- The plan uses the starts counted (premium_usage, mock_test.start) are also
-- left alone, for the same reason: the mocks were really sat. Delete those rows
-- by hand if the intent is to give the allowance back.

BEGIN;

DO $rollback$
DECLARE
  _papers int;
  _answers int;
  _mistakes int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'mock_attempts'
  ) THEN
    RAISE EXCEPTION '20261115000000 was never applied here — there is nothing to roll back';
  END IF;

  SELECT count(*) INTO _papers  FROM public.mock_attempts;
  SELECT count(*) INTO _answers FROM public.mock_answers;
  SELECT count(*) INTO _mistakes
    FROM public.student_mistakes sm
   WHERE sm.source_id IN (SELECT a.id FROM public.mock_attempts a);

  IF _papers > 0 AND COALESCE(current_setting('gurukul.drop_mock_papers', true), '') <> 'yes' THEN
    RAISE EXCEPTION
      '% mock paper(s) and % answer(s) would be destroyed. Re-run after SET gurukul.drop_mock_papers = ''yes'' in this session to mean it.',
      _papers, _answers;
  END IF;

  RAISE NOTICE 'dropping % mock paper(s) and % answer(s); % mistake row(s) they wrote are kept',
    _papers, _answers, _mistakes;
END
$rollback$;

DROP FUNCTION IF EXISTS public.rpc_my_mock_history();
DROP FUNCTION IF EXISTS public.rpc_mock_result(uuid);
DROP FUNCTION IF EXISTS public.rpc_mock_submit(uuid);
DROP FUNCTION IF EXISTS public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer);
DROP FUNCTION IF EXISTS public.rpc_mock_paper(uuid);
DROP FUNCTION IF EXISTS public.rpc_mock_start(text);
DROP FUNCTION IF EXISTS public.rpc_mock_catalog();
DROP FUNCTION IF EXISTS public._mock_result_json(uuid);
DROP FUNCTION IF EXISTS public._mock_close_expired(uuid);
DROP FUNCTION IF EXISTS public._mock_grade(uuid, boolean);
DROP FUNCTION IF EXISTS public._mock_paper_view(uuid);
DROP FUNCTION IF EXISTS public._mock_pick_questions(text);
DROP FUNCTION IF EXISTS public._mock_subject_supply();

DROP TABLE IF EXISTS public.mock_answers;
DROP TABLE IF EXISTS public.mock_attempts;

-- The catalog, back to counting the bank itself — the body 20261110000000 gave
-- it, character for character, so that rolling this back leaves the file that
-- owns it in charge again.
CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer DEFAULT NULL::integer,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH mine AS (
    -- The caller's own exam account, when they are one (one per account).
    SELECT ea.exam_id, ea.stream
      FROM public.exam_accounts ea
     WHERE ea.school_id = (SELECT public.get_my_school_id())
  )
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank_student qb
   WHERE qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND CASE
       WHEN EXISTS (SELECT 1 FROM mine) THEN
         -- An exam account: its exam (the view) and its stream's syllabus.
         qb.exam_id IS NOT NULL
         AND qb.chapter_id IN (
           SELECT s.chapter_id
             FROM mine
             JOIN public.exam_syllabus_chapters s ON s.exam_id = mine.exam_id AND s.stream = mine.stream)
       ELSE
         -- A school student: their school's board (the view), their class.
         qb.exam_id IS NULL
         AND qb.class_level = _class_level
         AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL)
     END
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$function$;

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text) IS
  'Subjects and chapters a student can practise, with counts. Board and exam come from question_bank_student (the caller''s school and exam account), never from the request.';

-- Now that nothing reads it.
DROP FUNCTION IF EXISTS public._student_bank_pool(integer, text);
DROP FUNCTION IF EXISTS public._mock_paper();

-- Fail closed: the doors must all be gone, and the catalog must still answer.
DO $verify$
DECLARE
  _left text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _left
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE '%mock%' OR p.proname = '_student_bank_pool');
  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'these are still here after the rollback: %', _left;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name IN ('mock_attempts', 'mock_answers')) THEN
    RAISE EXCEPTION 'a mock table survived the rollback';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rpc_practice_bank_catalog') <> 2 THEN
    RAISE EXCEPTION 'the practice catalog is not back as its two forms';
  END IF;
  IF position('question_bank_student' IN
              pg_get_functiondef('public.rpc_practice_bank_catalog(integer,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the catalog was not put back to counting the bank itself';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20261115000000_a_full_cuet_mock_test';

COMMIT;
