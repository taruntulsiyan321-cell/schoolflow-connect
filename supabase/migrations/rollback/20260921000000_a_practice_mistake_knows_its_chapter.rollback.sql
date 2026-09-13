-- Rollback for 20260921000000.
--
-- Removes the trigger that keys a practice mistake to its chapter.
--
-- READ THIS FIRST: applying this rollback re-starves the 7C recovery and
-- revision engine. _apply_chapter_state filters `sm.chapter_id IS NOT NULL`,
-- so with the trigger gone every new practice mistake is invisible to it: the
-- 5-open-mistakes trigger stops firing, no chapter_state row is created from
-- practice, and rpc_recovery_session_plan finds no tier-0 questions.
--
-- The backfill is deliberately NOT undone. Those chapter_ids are correct —
-- each was read from the question's own question_bank row — and clearing them
-- would destroy keyed history to no purpose. If they genuinely must go:
--
--   UPDATE public.student_mistakes SET chapter_id = NULL
--    WHERE source IN ('practice', 'dpp', 'battleground');
--
-- which leaves the test path's own chapter_ids intact.

BEGIN;

DROP TRIGGER IF EXISTS student_mistakes_set_chapter_id ON public.student_mistakes;
DROP FUNCTION IF EXISTS public.tg_student_mistakes_set_chapter_id();

COMMIT;
