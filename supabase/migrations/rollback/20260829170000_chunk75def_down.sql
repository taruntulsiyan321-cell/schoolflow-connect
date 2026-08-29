-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7.5d, 7.5e and 7.5f
--   20260829170000  the tests feature columns
--   20260829180000  recovery_assignments.source_type vocabulary
--   20260829190000  the four dropped DPP functions
--
-- LIMIT — the four dropped functions do NOT come back.
--   rpc_dpp_start, rpc_dpp_submit, rpc_dpp_pick_from_bank and
--   _capture_dpp_mistakes were dropped in 7.5f, and by the time anyone runs
--   this the DPP tables they operate on are gone too (7.5g). Recreating them
--   would produce four functions that immediately fail on a missing relation.
--   Their definitions are in git history if the whole chunk is being reverted.
--
-- The column and vocabulary halves ARE reversed, because those are what a
-- reverted client would break against.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 7.5e: recovery_assignments.source_type back to naming dpp.
ALTER TABLE public.recovery_assignments DROP CONSTRAINT IF EXISTS recovery_assignments_source_type_check;
UPDATE public.recovery_assignments SET source_type = 'dpp' WHERE source_type = 'test';
ALTER TABLE public.recovery_assignments
  ADD CONSTRAINT recovery_assignments_source_type_check
  CHECK (source_type = ANY (ARRAY['practice', 'dpp', 'battle']));

-- 7.5d: the feature columns. Dropped WITH their data — every one was added by
-- 7.5d and nothing before it wrote them, so there is nothing older to lose.
ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_difficulty_check;
ALTER TABLE public.tests
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS instructions,
  DROP COLUMN IF EXISTS difficulty,
  DROP COLUMN IF EXISTS test_kind,
  DROP COLUMN IF EXISTS total_marks,
  DROP COLUMN IF EXISTS chapter_id,
  DROP COLUMN IF EXISTS chapter,
  DROP COLUMN IF EXISTS chapters,
  DROP COLUMN IF EXISTS topics,
  DROP COLUMN IF EXISTS scheduled_publish_at,
  DROP COLUMN IF EXISTS archived_at;

COMMIT;
