-- Question Bank Semantic Search — lets Nova check for an existing, already-verified
-- question before generating a new answer (authoritative source preferred over generation).
-- class_level + subject are HARD SQL filters, never part of the similarity score, so a
-- semantically-similar-but-wrong-class/subject question can never be returned regardless
-- of embedding quality (Class 12 Economics must never match Class 7 Science).

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embed_status text NOT NULL DEFAULT 'pending_embed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_bank_embed_status_check'
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT question_bank_embed_status_check
      CHECK (embed_status IN ('pending_embed', 'embedded', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS question_bank_embed_status
  ON public.question_bank (embed_status)
  WHERE embed_status = 'pending_embed';

-- p_subjects is an array, not a single required subject: a free-form question doesn't come
-- with a known subject label attached, so this scopes to "any of the student's enrolled
-- subjects" when provided, or class_level + similarity threshold alone when NULL (the
-- threshold is the real safety net for cross-subject bleed; class_level is the hard, always-on
-- guard against the specific leakage case that mattered most: Class 12 Economics vs Class 7 Science).
CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector(1536),
  p_class_level int,
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
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_question_bank(vector, int, text[], float, int) TO authenticated, service_role;
