-- Rollback 20261053000000_nova_socratic_subject_cache
-- Restores case-sensitive subject match and retires v3 prompt (does not re-disable flags).

BEGIN;

UPDATE public.ai_prompt_library
SET status = 'retired', updated_at = now()
WHERE capability_id = 'student.nova.chat' AND version = 'v3';

UPDATE public.ai_prompt_library
SET status = 'production', updated_at = now()
WHERE capability_id = 'student.nova.chat' AND version = 'v2';

-- Recreate prior match_ai_answer_cache (case-sensitive ANY)
DROP FUNCTION IF EXISTS public.match_ai_answer_cache(vector, int, uuid, text[], float, int);
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
    AND (p_subjects IS NULL OR c.subject IS NULL OR c.subject = ANY(p_subjects))
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_ai_answer_cache(vector, int, uuid, text[], float, int)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.match_question_bank(vector, integer, uuid, text[], double precision, integer);
CREATE FUNCTION public.match_question_bank(
  p_query_embedding vector, p_class_level integer, p_school_id uuid DEFAULT NULL::uuid,
  p_subjects text[] DEFAULT NULL::text[], p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3)
RETURNS TABLE(id uuid, question text, options jsonb, correct_index integer, explanation text,
              subject text, chapter text, topic_id uuid, topic text, similarity double precision)
LANGUAGE sql STABLE
AS $function$
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.chapter, qb.topic_id, t.name,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  LEFT JOIN public.topics t ON t.id = qb.topic_id
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
REVOKE ALL ON FUNCTION public.match_question_bank(vector, integer, uuid, text[], double precision, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_question_bank(vector, integer, uuid, text[], double precision, integer)
  TO authenticated, service_role;

COMMIT;
