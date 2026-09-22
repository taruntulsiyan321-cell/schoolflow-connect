-- ════════════════════════════════════════════════════════════════════════════
-- THE LOAD TEST LEAVES THE LOOP
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠ PREPARED, NOT APPLIED. Running it needs a delete permission this session
-- does not hold. Everything below is measured; none of it has been executed.
--
-- LOOP_END_TO_END_VERIFY reported 482 open mistakes that nothing could ever
-- clear. What those rows actually are:
--
--   480  question_text = 'Scale fixture mistake N', 40 students, subjects
--        Physics/Chemistry/Biology/Hindi/English, chapters named "Chapter 2"
--        .. "Chapter 6", correct_answer "A", student_answer "C",
--        no options, no question_id, no chapter_id
--     2  real questions from the retired generator — and BOTH carry options,
--        so both are already practisable and clearable. Nothing wrong with them.
--
-- So it was never 482 stuck entries. It is a load test nobody cleaned up,
-- sitting in 40 students' mistake books and counting against them on every
-- screen that shows an open-mistake total.
--
-- WHY THEY CANNOT BE REPAIRED INSTEAD
--
-- Zero of the 480 match any question in the bank by text, so there is nothing
-- to link them to. They carry no options, so `correct_answer: "A"` names a
-- choice that exists nowhere: the Mistake Book cannot render them to be
-- retried, and a retry is the only thing that clears an entry. An entry that
-- cannot be shown, retried or cleared is not a mistake book entry — it is a
-- permanent addition to a number the student is being asked to bring down.
--
-- They are not student work. Nobody answered them. The real practice history
-- lives in question_attempts and is untouched by this.
--
-- THE SAME LOAD TEST IS IN THE REVISION QUEUE
--
--   200 revision_queue rows, reason = 'scale fixture' (160 open, 40 completed),
--   same 40 students, same invented chapters.
--
-- 'scale fixture' is a reason _rebuild_revision_queue never writes — it writes
-- 'weak_topic' — so these are foreign to the engine, and they are read live by
-- rpc_student_revision_queue, rpc_student_academic_snapshot and the AI context
-- API. They go with the mistakes.
--
-- NO FOREIGN KEY references student_mistakes, so these deletes orphan nothing.
--
-- ROLLBACK: supabase/migrations/rollback/20261028000000_down.sql — read it
-- first: a delete of seeded rows cannot be honestly undone by SQL.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $clean$
DECLARE _m int; _r int;
BEGIN
  DELETE FROM public.student_mistakes
   WHERE source = 'practice'
     AND question_id IS NULL
     AND question_text ILIKE 'scale fixture%';
  GET DIAGNOSTICS _m = ROW_COUNT;

  DELETE FROM public.revision_queue WHERE reason = 'scale fixture';
  GET DIAGNOSTICS _r = ROW_COUNT;

  RAISE NOTICE 'removed % fixture mistake(s), % fixture revision row(s)', _m, _r;
END $clean$;

DO $check$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.student_mistakes
   WHERE source='practice' AND question_id IS NULL AND question_text ILIKE 'scale fixture%';
  IF _n > 0 THEN RAISE EXCEPTION '% fixture mistake(s) survived', _n; END IF;

  SELECT count(*) INTO _n FROM public.revision_queue WHERE reason='scale fixture';
  IF _n > 0 THEN RAISE EXCEPTION '% fixture revision row(s) survived', _n; END IF;

  -- The loop's own requirement: an open mistake must be one a student can act on.
  SELECT count(*) INTO _n FROM public.student_mistakes
   WHERE status='open' AND source='practice'
     AND question_id IS NULL AND options IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION '% open mistake(s) still carry neither a question nor options', _n;
  END IF;
END $check$;

COMMIT;
