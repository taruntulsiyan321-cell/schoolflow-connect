-- ═══════════════════════════════════════════════════════════════════════════
-- Contributed questions enter UNAPPROVED, and the author can still use them
--
-- THE PROBLEM. `is_approved` DEFAULTED TO TRUE and the service set it true
-- again, so a teacher's contribution became readable by students at EVERY
-- school the moment it saved — `qb_select_approved_board` asks only
-- `is_approved AND board matches`, and the bank has no `school_id` to scope by.
-- The author fence (20260906030000) governs who may EDIT a row; it never
-- governed who may SEE one.
--
-- WHY NOT SIMPLY DEFAULT IT FALSE. That alone would make contributions
-- invisible to their own author through the retrieval path, and there is no
-- approval mechanism anywhere to turn them back on. So visibility is scoped by
-- AUTHORSHIP, which is the one dimension this schema can express:
--
--     is_approved  OR  created_by = auth.uid()
--
-- WHAT EACH CALLER SEES AFTER THIS.
--   · the author  — their own unapproved questions, in their own papers.
--   · another teacher — approved rows only. (RLS `qb_staff_read` still lets
--     staff READ the table directly; this narrows RETRIEVAL, which is what
--     builds a paper.)
--   · a student — approved rows only, unchanged. `qb_select_approved_board`
--     already required `is_approved`, so students are doubly fenced: by RLS and
--     by this predicate. This migration REMOVES a cross-school propagation
--     risk for them and adds nothing.
--   · service_role (aiRouter.ts) — `auth.uid()` is NULL there, so the disjunct
--     is never true and behaviour is byte-for-byte what it was.
--
-- NOT AFFECTED: `ai-recovery-variants` sets `is_approved: true` EXPLICITLY
-- (index.ts:289), so the frozen recovery path does not change. Checked, not
-- assumed.
--
-- AN APPROVAL QUEUE IS NOT v1. Until one exists, a contribution is usable by
-- its author and invisible to everyone else. That is a deliberate stopping
-- point, recorded in KNOWN_ISSUES, and it is required before the bank is
-- meant to grow cross-school.
--
-- ALSO FIXED HERE: the citation in this function's own body. It said the bank
-- is "shared across schools by design (§4.2a)". §4.2a is
-- `docs/recovery-revision-analysis-spec.md:193` ("Generating the variants"),
-- part of the frozen recovery feature, and its "shared bank" means shared
-- across STUDENTS over time. The clause that says "Centralised and shared
-- across all schools and all users" is §10.9, `docs/locked-decisions.md:385`.
-- The substance was right; only the pointer was wrong. Corrected while the
-- function is being replaced anyway, rather than in a migration of its own.
--
-- Verified by probe16, not a DO block (rule 6), with the student control and
-- the cross-school approved control paired against the denials (rule 8).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Entry is unapproved ───────────────────────────────────────────────────
ALTER TABLE public.question_bank ALTER COLUMN is_approved SET DEFAULT false;

COMMENT ON COLUMN public.question_bank.is_approved IS
  'Approved for general circulation. DEFAULTS FALSE since 20260907000000: a '
  'contribution is visible to students only after approval, and there is no '
  'approval mechanism yet. Its author can still retrieve it -- '
  'match_question_bank admits `is_approved OR created_by = auth.uid()`. The '
  'reference seed is all true. Not a tenancy control: the bank has no '
  'school_id and is shared across all schools by §10.9.';

-- ── Retrieval admits the caller's own unapproved contributions ────────────
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
  -- question_bank has no school_id and is shared across all schools and all
  -- users by design -- §10.9, docs/locked-decisions.md:385. (This comment
  -- previously cited §4.2a, which is a different clause in a different
  -- document and governs variant generation, not cross-school sharing.)
  --
  -- The tenancy dimension is BOARD, and this is the same test the RLS policy
  -- qb_select_approved_board makes -- written here against p_school_id so that
  -- it also holds for service_role, which bypasses RLS entirely and is the
  -- caller aiRouter.ts uses.
  --
  -- No `p_school_id IS NULL OR ...` escape: an unknown school narrows the
  -- result to board-agnostic rows rather than opening it (G14).
  --
  -- `created_by = auth.uid()` is never true for service_role (auth.uid() is
  -- NULL there) and never true for the reference seed (created_by is NULL on
  -- all 21,696 rows), so it widens the result for exactly one caller: the
  -- teacher who wrote the question.
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND (qb.is_approved = true OR qb.created_by = auth.uid())
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
