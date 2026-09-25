-- ANALYSIS COUNTS THE QUESTIONS YOU STILL SKIPPED — THE ONES SKIPPED MODE SERVES.
--
-- Analysis's chapter list says "You skipped N questions in <chapter>" and
-- offers "Try the ones you skipped". It counted every SKIP ATTEMPT: a
-- question skipped three times was 3, and a question skipped and answered
-- since still counted. Skipped mode serves something else — questions whose
-- latest answer is a skip (_still_skipped_questions, 20261057000000) — so the
-- number on the row and the session behind its button disagreed.
--
-- rpc_my_skipped_by_chapter counts from that same function, per chapter and
-- per topic, uncapped (rpc_my_skipped_questions caps at 200 ids because it
-- serves a session; a count must not).
--
-- rpc_student_chapter_analysis (20261057000000/58) goes: the chapter list
-- that shipped is derived in the client from the student's own rows, and
-- nothing calls it.
CREATE OR REPLACE FUNCTION public.rpc_my_skipped_by_chapter()
 RETURNS TABLE (chapter_id uuid, topic text, questions integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  RETURN QUERY
  SELECT q.chapter_id, t.name, count(*)::int
    FROM public._still_skipped_questions(_uid) s
    JOIN public.question_bank q ON q.id = s.bank_question_id
    LEFT JOIN public.topics t ON t.id = q.topic_id
   WHERE q.chapter_id IS NOT NULL
   GROUP BY q.chapter_id, t.name;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_my_skipped_by_chapter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_skipped_by_chapter() TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_student_chapter_analysis();

DO $proof$
DECLARE _student uuid := 'd1000003-0001-4000-8000-000000000001'; _by_rpc int; _truth int; _attempts int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COALESCE(sum(questions), 0) INTO _by_rpc FROM public.rpc_my_skipped_by_chapter();
  RESET ROLE;

  SELECT count(*) INTO _truth FROM public._still_skipped_questions(_student) s
    JOIN public.question_bank q ON q.id = s.bank_question_id WHERE q.chapter_id IS NOT NULL;
  -- The old count, for the record: every skip attempt.
  SELECT count(*) INTO _attempts FROM public.question_attempts qa
    JOIN public.question_bank q ON q.id = qa.bank_question_id
   WHERE qa.user_id = _student AND qa.skipped AND q.chapter_id IS NOT NULL;

  IF _by_rpc <> _truth THEN RAISE EXCEPTION 'the chapter count (%) is not the Skipped-mode count (%)', _by_rpc, _truth; END IF;
  IF to_regprocedure('public.rpc_student_chapter_analysis()') IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_student_chapter_analysis still exists';
  END IF;
  RAISE NOTICE 'OK: % still-skipped questions (skip attempts: %)', _by_rpc, _attempts;
END
$proof$;
