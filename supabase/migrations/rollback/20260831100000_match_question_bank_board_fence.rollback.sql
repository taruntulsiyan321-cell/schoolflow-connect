-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — match_question_bank board fence
-- Undoes 20260831100000_match_question_bank_board_fence.sql
--
-- Restores match_question_bank() to its pre-fence body — the one installed by
-- 20260830160000, NOT the older broken one. Rolling back re-opens cross-board
-- matching: a question from another board can again be returned to a student.
--
-- The migration's two INSERTs need no undo. They are "FENCE PROBE" fixtures
-- inserted and deleted inside the verification block (two INSERTs, two matching
-- DELETEs), so they never outlive the transaction that made them.
--
-- ── Order matters ─────────────────────────────────────────────────────────
--
-- These rollbacks unwind a CHAIN. Several of these migrations replaced a
-- function that a later one replaced again, so restoring an older body out of
-- order silently discards the newer fix. Apply rollbacks in reverse timestamp
-- order, newest first.
--
-- ── What this file can and cannot promise ─────────────────────────────────
--
-- It restores the definition recorded in the migration named below, which is
-- the last one in this repository before the migration being undone. If some
-- session had replaced that function directly against the database without
-- writing a migration, that out-of-band body is not in the repo and is not
-- recoverable here. Nothing in the repo suggests that happened for these.

-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- match_question_bank() — body extracted verbatim from 20260830160000_fix_stale_column_refs.sql
CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector,
  p_class_level integer,
  p_school_id uuid DEFAULT NULL::uuid,
  p_subjects text[] DEFAULT NULL::text[],
  p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3)
 RETURNS TABLE(id uuid, question text, options jsonb, correct_index integer, explanation text, subject text, concept text, chapter text, topic text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  -- p_school_id is accepted and UNUSED. question_bank has no school_id column;
  -- the bank is shared across schools and the scoping that applies is the board
  -- filter in the RLS policy qb_select_approved_board, which reaches this
  -- function because it is SECURITY INVOKER. The parameter is retained because
  -- callers pass it positionally.
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND qb.class_level = p_class_level
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$function$;


DO $guard$
DECLARE _missing text;
BEGIN
  SELECT string_agg(x, ', ') INTO _missing
    FROM unnest(ARRAY['match_question_bank']) AS x
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = x);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not leave these defined: %', _missing;
  END IF;
END
$guard$;

COMMIT;