-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — contributions go back to entering APPROVED
--
-- This RESTORES THE CROSS-SCHOOL PROPAGATION deliberately: after this runs, a
-- teacher's contribution is again readable by students at every school on a
-- matching board the moment it saves, because `qb_select_approved_board` asks
-- only `is_approved AND board matches` and there is no school_id to scope by.
--
-- Rows already written while the new default was in force KEEP
-- `is_approved = false`. Nothing is back-filled — flipping existing
-- contributions to approved is an approval decision, not a schema rollback, and
-- this file must not make it silently.
--
-- The §4.2a citation is restored verbatim too, so the function body matches
-- what a pre-20260907000000 checkout expects.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.question_bank ALTER COLUMN is_approved SET DEFAULT true;

COMMENT ON COLUMN public.question_bank.is_approved IS NULL;

CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector,
  p_class_level integer,
  p_school_id uuid DEFAULT NULL::uuid,
  p_subjects text[] DEFAULT NULL::text[],
  p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3
)
RETURNS TABLE(
  id uuid, question text, options jsonb, correct_index integer, explanation text,
  subject text, concept text, chapter text, topic text, similarity double precision
)
LANGUAGE sql
STABLE
AS $function$
  -- question_bank has no school_id and is shared across schools by design
  -- (§4.2a). The tenancy dimension is BOARD, and this is the same test the RLS
  -- policy qb_select_approved_board makes — written here against p_school_id so
  -- that it also holds for service_role, which bypasses RLS entirely and is the
  -- only caller this function actually has (aiRouter.ts).
  --
  -- No `p_school_id IS NULL OR …` escape: an unknown school narrows the result
  -- to board-agnostic rows rather than opening it (G14).
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND qb.class_level = p_class_level
    AND (qb.board IS NULL
         OR qb.board = 'both'
         OR qb.board = (SELECT s.board FROM public.schools s WHERE s.id = p_school_id))
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$function$;

COMMIT;
