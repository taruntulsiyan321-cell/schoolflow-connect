-- ===========================================================================
-- MATCH THE BANK FOR AN EXAM
--
-- Binding: docs/custom-practice-upload-spec.md §5.2
--          docs/screen-capture-mistakes-spec.md §7.2 (same need — build once)
--
-- match_question_bank filters by class_level + school board. CUET individuals
-- have class_id NULL and practise by exam_id. A second function — not a
-- loosened escape on the first — keeps school callers honest (G14) and gives
-- upload / screen-capture tag inheritance one shared door.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_question_bank_for_exam(
  p_query_embedding vector,
  p_exam_id uuid,
  p_subjects text[] DEFAULT NULL::text[],
  p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3
)
RETURNS TABLE(
  id uuid,
  question text,
  options jsonb,
  correct_index integer,
  explanation text,
  subject text,
  chapter text,
  chapter_id uuid,
  topic_id uuid,
  topic text,
  difficulty text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- No p_exam_id IS NULL escape: unknown exam returns nothing (G14).
  SELECT
    qb.id,
    qb.question,
    qb.options,
    qb.correct_index,
    qb.explanation,
    qb.subject,
    qb.chapter,
    qb.chapter_id,
    qb.topic_id,
    t.name,
    qb.difficulty,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  LEFT JOIN public.topics t ON t.id = qb.topic_id
  WHERE p_exam_id IS NOT NULL
    AND qb.exam_id = p_exam_id
    AND qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND (p_subjects IS NULL OR qb.subject = ANY (p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$function$;

COMMENT ON FUNCTION public.match_question_bank_for_exam(vector, uuid, text[], double precision, integer) IS
  'Exam-scoped vector match for private-upload / screen-capture tag inheritance. Spec §5.2. Does not replace match_question_bank.';

REVOKE ALL ON FUNCTION public.match_question_bank_for_exam(vector, uuid, text[], double precision, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_question_bank_for_exam(vector, uuid, text[], double precision, integer)
  TO authenticated, service_role;

DO $$
BEGIN
  IF NOT has_function_privilege(
    'authenticated',
    'public.match_question_bank_for_exam(vector,uuid,text[],double precision,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: authenticated cannot execute match_question_bank_for_exam';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.match_question_bank_for_exam(vector,uuid,text[],double precision,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: anon can execute match_question_bank_for_exam';
  END IF;
  -- Positive control: school match_question_bank must still exist unchanged.
  IF to_regprocedure('public.match_question_bank(vector,integer,uuid,text[],double precision,integer)') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: school match_question_bank was dropped — rewrite, do not replace';
  END IF;
END $$;

COMMIT;
