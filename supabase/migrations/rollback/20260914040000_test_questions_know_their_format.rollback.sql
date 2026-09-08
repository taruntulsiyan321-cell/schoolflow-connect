-- Rollback for 20260914040000_test_questions_know_their_format.sql
--
-- Drops the two constraints, the two columns, and the §10.24 refusal in the
-- attempt path.
--
-- WHAT COMES BACK IS THE TRAP, not just the old shape. Without
-- `test_questions_shape_matches_format` there is nothing stopping a written
-- answer being stored in `correct`, which is the two-homes shape (G9) the
-- migration existed to prevent — one jsonb column meaning "the correct option"
-- or "a paragraph a person marks", decided by a format that is once again
-- recorded nowhere.
--
-- DROPPING `answer` DESTROYS DATA if any written question was ever stored. At
-- the time of writing there were none (576 rows, all MCQ) and nothing could
-- create one. Check before running this:
--
--   SELECT count(*) FROM public.test_questions WHERE question_format <> 'mcq';

BEGIN;

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_shape_matches_format;
ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_question_format_check;
ALTER TABLE public.test_questions DROP COLUMN IF EXISTS question_format;
ALTER TABLE public.test_questions DROP COLUMN IF EXISTS answer;

CREATE OR REPLACE FUNCTION public.rpc_test_questions_for_attempt(_attempt_id uuid)
RETURNS TABLE(id uuid, order_index integer, question text, options jsonb, marks numeric, chapter_id uuid, chapter text, concept text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _test uuid; _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT a.test_id, a.user_id INTO _test, _owner
    FROM public.test_attempts a WHERE a.id = _attempt_id;

  IF _test IS NULL THEN RAISE EXCEPTION 'no such attempt'; END IF;

  -- SECURITY DEFINER, so this is the only gate there is (G13).
  IF _owner <> _uid THEN RAISE EXCEPTION 'Not your attempt'; END IF;

  -- `correct` and `explanation` are deliberately absent from the RETURNS
  -- list. A student receives the paper, not the answer key.
  RETURN QUERY
    SELECT q.id, q.order_index, q.question, q.options,
           q.marks, q.chapter_id, q.chapter, q.concept
      FROM public.test_questions q
     WHERE q.test_id = _test
     ORDER BY q.order_index;
END;
$function$;

COMMIT;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='test_questions'
                AND column_name IN ('question_format','answer')) THEN
    RAISE EXCEPTION 'ABORT: a column survived the rollback';
  END IF;
  -- Positive control: the student must still not receive the answer key.
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='rpc_test_questions_for_attempt') ~ 'q\.correct' THEN
    RAISE EXCEPTION 'ABORT: the restored attempt path returns the answer key';
  END IF;
  RAISE NOTICE 'test_questions is back to one jsonb column meaning two things.';
END $verify$;
