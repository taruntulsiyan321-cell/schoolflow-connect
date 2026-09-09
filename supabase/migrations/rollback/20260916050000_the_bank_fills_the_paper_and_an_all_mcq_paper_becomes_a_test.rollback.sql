-- Rollback for 20260916050000_the_bank_fills_the_paper_and_an_all_mcq_paper_becomes_a_test
--
-- Drops both RPCs. They are additive and read-only against the bank; nothing
-- references them from SQL — no policy, no trigger, no view — so dropping them
-- cannot orphan a row.
--
-- WHAT ROLLING THIS BACK COSTS: the question-paper screen loses its two verbs.
-- A teacher can still build a paper and type questions by hand; they cannot
-- pull any from the bank, and they cannot push an all-MCQ paper out as an
-- online test. Papers already built, and the questions already in them, are
-- untouched — they are rows in `question_paper_questions`, not state inside
-- these functions.
--
-- The authorship fence from 20260916040000 is a separate migration and is NOT
-- undone here. Rolling back a feature must not reopen a hole.

DROP FUNCTION IF EXISTS public.rpc_fill_paper_section_from_bank(uuid);
DROP FUNCTION IF EXISTS public.rpc_question_paper_to_test(uuid, uuid, integer);

DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('rpc_fill_paper_section_from_bank','rpc_question_paper_to_test');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % paper RPC(s) still present', _n;
  END IF;

  -- The authorship fence must survive this rollback, or undoing a feature
  -- would hand question-paper writes back to students and the principal.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='can_author_question_paper'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: this rollback removed the 20260916040000 authorship fence as well';
  END IF;

  RAISE NOTICE 'paper RPCs removed; the authorship fence is intact and the papers themselves are untouched.';
END $verify$;
