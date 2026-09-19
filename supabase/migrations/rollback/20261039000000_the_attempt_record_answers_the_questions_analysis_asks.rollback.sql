-- ROLLBACK for 20261039000000_the_attempt_record_answers_the_questions_analysis_asks.
--
-- READ THIS FIRST. Dropping this function blanks most of the Analysis page:
-- the chapter grid, the subject list and radar, topic and chapter time, the
-- difficulty breakdown, the effort tiles and the recurring-mistakes panel all
-- read it. There is no fallback — the concept_mastery path they replaced was
-- removed deliberately, because it is a derived table already caught
-- disagreeing with the attempts it is built from.
--
-- Roll this back only together with a revert of the Analysis page itself.

DROP FUNCTION IF EXISTS public.rpc_student_practice_analytics();

DO $$
BEGIN
  RAISE NOTICE 'rpc_student_practice_analytics dropped; Analysis will fail to load its chapter, subject, topic-time, difficulty and effort panels';
END $$;
