-- S-01 / S-02 (CONFIRMED via independent live verification, both high confidence):
-- match_question_bank and match_ai_answer_cache are both called exclusively via a
-- service_role ("admin") client from supabase/functions/_shared/aiRouter.ts's Nova
-- question-matching step. service_role has rolbypassrls=true, so table-level RLS
-- (which DOES correctly scope both underlying tables) never runs for this call path --
-- the function body's own WHERE clause is the only real gate, and neither function
-- filters by school_id at all.
--
-- Live blast radius confirmed before this fix:
--   question_bank: 21708/21758 rows are global (school_id NULL, by design -- shared
--     curriculum content) but 50 rows are school-scoped, all embed_status='embedded'
--     (i.e. live-searchable).
--   ai_answer_cache: ALL 15 rows currently in the table are school-scoped (school_id
--     NOT NULL) -- zero global rows -- so 100% of cached AI answers are currently
--     exposed to cross-school reads via this path.
-- Only one school exists in the live DB today, so there is no second tenant to
-- actually leak to yet -- but the gap is structural and would matter immediately on
-- the next school onboarding, and is exactly the kind of thing that's silent until
-- it isn't.
--
-- Fix: add a nullable p_school_id parameter to both, mirroring the same
-- "global-or-mine" predicate already used by the RLS policies on both underlying
-- tables (question_bank's qb_select_approved_board, and the same shape used
-- elsewhere for ai_answer_cache) -- so RPC-path behavior matches RLS-path behavior
-- instead of silently being wider. Old 5-arg signatures are dropped, not just
-- shadowed, so nothing can keep calling the insecure version by accident.
-- ============================================================================

DROP FUNCTION IF EXISTS public.match_question_bank(vector, int, text[], float, int);
CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector(1536),
  p_class_level int,
  p_school_id uuid DEFAULT NULL,
  p_subjects text[] DEFAULT NULL,
  p_match_threshold float DEFAULT 0.82,
  p_match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  question text,
  options jsonb,
  correct_index int,
  explanation text,
  subject text,
  concept text,
  chapter text,
  topic text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND qb.class_level = p_class_level
    AND (qb.school_id IS NULL OR qb.school_id = p_school_id)
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_question_bank(vector, int, uuid, text[], float, int) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.match_ai_answer_cache(vector, int, text[], float, int);
CREATE OR REPLACE FUNCTION public.match_ai_answer_cache(
  p_query_embedding vector(1536),
  p_class_level int,
  p_school_id uuid DEFAULT NULL,
  p_subjects text[] DEFAULT NULL,
  p_match_threshold float DEFAULT 0.65,
  p_match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  original_question text,
  answer text,
  subject text,
  concept text,
  chapter text,
  topic text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id, c.original_question, c.answer, c.subject, c.concept, c.chapter, c.topic,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.ai_answer_cache c
  WHERE c.review_status != 'rejected'
    AND c.embedding IS NOT NULL
    AND c.class_level = p_class_level
    AND (c.school_id IS NULL OR c.school_id = p_school_id)
    -- A subject-less cached row (no reference existed to infer one from at save time) is a
    -- general/unclassified answer and must not be excluded just because the QUERY has subject
    -- constraints — class_level + the similarity threshold are the real safety net here.
    AND (p_subjects IS NULL OR c.subject IS NULL OR c.subject = ANY(p_subjects))
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_ai_answer_cache(vector, int, uuid, text[], float, int) TO authenticated, service_role;

-- S-03 (checked, NOT applied as a fix — see chat summary): ai_embedding_jobs_process_batch
-- claiming globally without school scoping was investigated and found to not be a real bug --
-- FOR UPDATE SKIP LOCKED prevents cross-worker double-claim races (it doesn't cause them),
-- each returned job is already tagged with its own school_id so no data mixing occurs, and
-- the pipeline holds zero rows live today anyway. One harmless grant-hygiene cleanup,
-- matching the pattern already applied to sibling functions in 20260808040000:
REVOKE EXECUTE ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) FROM anon;
