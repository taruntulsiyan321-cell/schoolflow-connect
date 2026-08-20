-- AI Answer Cache — validated Nova-generated answers to genuinely new questions, kept
-- separate from question_bank (authoritative, curated content) per the explicit requirement
-- that AI-generated content must never silently become authoritative Pearson/RBSE content.
-- review_status exists so a future teacher/admin review UI can promote a row toward
-- authoritative status (or reject it) — no such UI is built yet, this is schema-only support.

CREATE TABLE IF NOT EXISTS public.ai_answer_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_question text NOT NULL,
  answer text NOT NULL,
  embedding vector(1536),
  class_level int,
  subject text,
  concept text,
  chapter text,
  topic text,
  source_type text NOT NULL DEFAULT 'ai_generated' CHECK (source_type IN ('ai_generated')),
  review_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'approved', 'rejected')),
  model_id text,
  request_id uuid,
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

ALTER TABLE public.ai_answer_cache ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (used exclusively by the edge function) bypasses RLS by design;
-- no direct client access is intended for this table.

CREATE INDEX IF NOT EXISTS ai_answer_cache_class_subject
  ON public.ai_answer_cache (class_level, subject)
  WHERE review_status != 'rejected';

CREATE OR REPLACE FUNCTION public.match_ai_answer_cache(
  p_query_embedding vector(1536),
  p_class_level int,
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
    -- A subject-less cached row (no reference existed to infer one from at save time) is a
    -- general/unclassified answer and must not be excluded just because the QUERY has subject
    -- constraints — class_level + the similarity threshold are the real safety net here.
    AND (p_subjects IS NULL OR c.subject IS NULL OR c.subject = ANY(p_subjects))
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_ai_answer_cache(vector, int, text[], float, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bump_ai_answer_cache_hit(p_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.ai_answer_cache SET hit_count = hit_count + 1, last_used_at = now() WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.bump_ai_answer_cache_hit(uuid) TO authenticated, service_role;
