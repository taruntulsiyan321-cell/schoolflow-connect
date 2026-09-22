-- ═══════════════════════════════════════════════════════════════════════════
-- A skipped question comes back
--
-- "Skipped Questions" has been dead since 2026-08-28 and said nothing about it.
--
-- ── HOW IT BROKE ─────────────────────────────────────────────────────────
--
-- 20260828170000_chunk7b_batch1_practice_tables.sql did three things in one
-- migration:
--
--   section 1-2  created practice_bookmarks and practice_skipped
--   section 5    carried the existing bookmarks and skips into them out of
--                the retiring question_records
--   section 7    stripped `PERFORM public._upsert_question_record(...)` from
--                rpc_record_question_attempt
--   section 9    dropped _upsert_question_record and question_records
--
-- Bookmarks kept a writer: section 6 repointed rpc_toggle_question_bookmark at
-- practice_bookmarks, so a bookmark still lands. Skips did not. The stripped
-- PERFORM was the only thing that had ever written one, and nothing replaced
-- it, so practice_skipped ended the migration with its historical rows, one
-- reader, and NO WRITER.
--
-- The build doc's own rule, G, "every new table ships with its write path in
-- the same chunk", is exactly the rule that was broken — and the failure is
-- the silent kind it exists to prevent: valid SQL against a table that is
-- simply never appended to. Every gate stayed green. The mode just returned
-- nothing, for every student, for every skip made since.
--
-- ── WHY THE TABLE GOES RATHER THAN GAINING A WRITER ──────────────────────
--
-- question_attempts already records every skip and always has:
-- rpc_record_question_attempt forces `skipped = true` (with is_correct false
-- and score 0) for a skip or a timeout, on the bank path and the template path
-- alike, and has done since 20260802250000. It carries the session, subject,
-- chapter, difficulty and timestamp with it.
--
-- So practice_skipped was never a missing writer. It was a SECOND HOME for a
-- fact the database already stored, and adding a writer would have created the
-- divergence 7B-1's own section 5b had just finished cleaning up between the
-- two mistake books. The reader moves to the authority and the duplicate goes.
--
-- practice_bookmarks is NOT touched. It is a genuinely separate fact — "come
-- back to this" is not recorded anywhere else — and it has a live writer.
--
-- Client side: PracticeService.listQuestionIdsByStatus reads question_attempts
-- for the skipped arm, deduped newest-first. Guarded by
-- src/academic/services/practiceSkippedSource.test.ts, which fails if any
-- reader is pointed back here.
--
-- Reverse: supabase/migrations/rollback/20260920000000_a_skipped_question_comes_back.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Prove the drop loses nothing ───────────────────────────────────────
--
-- Every row in practice_skipped was carried out of question_records by 7B-1.
-- The claim being made is that question_attempts holds the same skips, so the
-- move to it loses no student's history. That claim is checked here, against
-- the live table, rather than asserted in a comment — if a single skip exists
-- in practice_skipped that question_attempts cannot account for, this
-- migration stops and the table stays.
--
-- G11: this can fail. Seed one practice_skipped row for a question the user
-- never skipped in question_attempts and the EXCEPTION fires.
DO $prove$
DECLARE _orphans int;
BEGIN
  IF to_regclass('public.practice_skipped') IS NULL THEN
    RAISE NOTICE 'practice_skipped already gone; nothing to prove or drop';
    RETURN;
  END IF;

  SELECT count(*)::int INTO _orphans
    FROM public.practice_skipped ps
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.question_attempts qa
      WHERE qa.user_id = ps.user_id
        AND qa.bank_question_id = ps.question_id
        AND qa.skipped IS TRUE
   );

  IF _orphans > 0 THEN
    RAISE EXCEPTION
      'practice_skipped holds % skip(s) that question_attempts cannot account for. Dropping it would lose them — carry them into question_attempts first, or keep the table and give it a writer.',
      _orphans;
  END IF;

  RAISE NOTICE 'practice_skipped: every row is represented in question_attempts; safe to drop.';
END
$prove$;

-- ── 2. Drop it. Not deprecated, not commented out (G9). ───────────────────
DROP TABLE IF EXISTS public.practice_skipped;

-- ── 3. Nothing may still reference it ─────────────────────────────────────
DO $assert$
DECLARE _bad text;
BEGIN
  IF to_regclass('public.practice_skipped') IS NOT NULL THEN
    RAISE EXCEPTION 'practice_skipped survived the drop';
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.prosrc ~ '\mpractice_skipped\M';

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'these functions still reference practice_skipped: %', _bad;
  END IF;
END
$assert$;

COMMIT;
