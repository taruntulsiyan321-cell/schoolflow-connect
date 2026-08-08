-- =============================================================================
-- ai_kms_retrieve_chunks: report whether a vector search was actually
-- attempted, independent of whether it returned hits
--
-- Found during the final AI-subsystem audit, immediately after wiring real
-- query-embedding generation into aiRouter.ts (student.knowledge.retrieve,
-- student.image_doubt.solve, student.concept.explain now all pass a real
-- OpenRouter-generated query_embedding into this RPC instead of always
-- passing null).
--
-- Root cause: the function sets v_mode := 'vector_compat' when
-- p_query_embedding is supplied and runs the vector branch -- but the very
-- next block unconditionally does `IF v_rows = '[]'::jsonb ... THEN
-- v_mode := 'lexical'` whenever the vector branch found zero rows, with no
-- way to tell "vector search ran and matched nothing" apart from "vector
-- search never ran" from the response alone. Verified live: calling this
-- RPC directly (via PostgREST, as a real authenticated user) with a
-- well-formed 1536-dim query_embedding against production's currently-empty
-- ai_kms_chunks table returns {"mode":"lexical", ...} -- identical to
-- calling it with query_embedding: null. Same result either way, so the
-- `mode` field alone cannot answer "did vector search actually execute" --
-- exactly the question this audit was asked to settle with evidence.
--
-- Fix: track whether the vector branch was attempted in a separate
-- v_vector_attempted boolean, returned as a new `vector_attempted` field.
-- `mode` keeps its existing meaning (which strategy actually produced the
-- returned hits) so no existing caller's behavior changes -- this is purely
-- additive observability, not a change to matching, ranking, or the
-- fallback-to-lexical-on-empty-vector-results behavior itself (which stays
-- exactly as before: still the right behavior, it just wasn't visible).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_kms_retrieve_chunks(
  p_school_id uuid,
  p_query text,
  p_role text DEFAULT 'student'::text,
  p_limit integer DEFAULT 5,
  p_min_score real DEFAULT 0.12,
  p_query_embedding real[] DEFAULT NULL::real[],
  p_subject text DEFAULT NULL::text,
  p_grade text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 20));
  v_role text;
  v_rows jsonb := '[]'::jsonb;
  v_mode text := 'lexical';
  v_vector_attempted boolean := false;
  v_caller_role text;
  v_is_service boolean := (
    current_user = 'service_role' OR coalesce(auth.role(), '') = 'service_role'
  );
BEGIN
  IF v_uid IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_is_service THEN
    v_role := lower(coalesce(nullif(trim(p_role), ''), 'student'));
  ELSE
    -- JWT callers: never trust client p_role for visibility
    v_caller_role := lower(coalesce(public.get_my_role()::text, ''));
    IF v_caller_role = '' THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
    v_role := v_caller_role;
  END IF;

  IF v_role NOT IN ('admin', 'teacher', 'student', 'parent', 'principal') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  IF NOT v_is_service THEN
    IF NOT (
      public.has_role(v_uid, 'admin'::public.app_role)
      OR public.has_role(v_uid, 'principal'::public.app_role)
      OR public.has_role(v_uid, 'teacher'::public.app_role)
      OR public.has_role(v_uid, 'student'::public.app_role)
      OR public.has_role(v_uid, 'parent'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
    -- School-bound admin/principal must stay in-tenant (no cross-school bypass).
    IF NOT public.same_school(p_school_id) THEN
      RAISE EXCEPTION 'not authorised for school';
    END IF;
  END IF;

  IF p_query_embedding IS NOT NULL AND array_length(p_query_embedding, 1) IS NOT NULL THEN
    v_vector_attempted := true;
    v_mode := 'vector_compat';
    SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.score DESC), '[]'::jsonb)
      INTO v_rows
    FROM (
      SELECT
        c.id AS chunk_id,
        c.document_id,
        c.version_id,
        c.chunk_index,
        left(c.chunk_text, 1200) AS chunk_text,
        c.chunk_metadata,
        c.embedding_model_version,
        c.embed_status,
        d.title AS document_title,
        d.content_type,
        d.status AS document_status,
        public.ai_cosine_similarity(c.embedding_compat, p_query_embedding) AS score,
        'vector_compat'::text AS match_mode
      FROM public.ai_kms_chunks c
      JOIN public.ai_kms_documents d ON d.id = c.document_id
      WHERE d.school_id = p_school_id
        AND d.status = 'published'
        AND c.published = true
        AND c.embed_status = 'embedded'
        AND c.embedding_compat IS NOT NULL
        AND (v_role = ANY (d.visibility_scope) OR v_role IN ('admin', 'principal'))
        AND (p_subject IS NULL OR d.subject IS NULL OR lower(d.subject) = lower(p_subject))
        AND (p_grade IS NULL OR d.grade IS NULL OR lower(d.grade) = lower(p_grade))
        AND public.ai_cosine_similarity(c.embedding_compat, p_query_embedding) >= p_min_score
      ORDER BY score DESC
      LIMIT v_limit
    ) t;
  END IF;

  IF v_rows = '[]'::jsonb OR v_rows IS NULL THEN
    v_mode := 'lexical';
    SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.score DESC), '[]'::jsonb)
      INTO v_rows
    FROM (
      SELECT
        c.id AS chunk_id,
        c.document_id,
        c.version_id,
        c.chunk_index,
        left(c.chunk_text, 1200) AS chunk_text,
        c.chunk_metadata,
        c.embedding_model_version,
        c.embed_status,
        d.title AS document_title,
        d.content_type,
        d.status AS document_status,
        public.ai_lexical_overlap(p_query, c.chunk_text) AS score,
        'lexical'::text AS match_mode
      FROM public.ai_kms_chunks c
      JOIN public.ai_kms_documents d ON d.id = c.document_id
      WHERE d.school_id = p_school_id
        AND d.status = 'published'
        AND c.published = true
        AND (v_role = ANY (d.visibility_scope) OR v_role IN ('admin', 'principal'))
        AND (p_subject IS NULL OR d.subject IS NULL OR lower(d.subject) = lower(p_subject))
        AND (p_grade IS NULL OR d.grade IS NULL OR lower(d.grade) = lower(p_grade))
        AND public.ai_lexical_overlap(p_query, c.chunk_text) >= p_min_score
      ORDER BY score DESC
      LIMIT v_limit
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'school_id', p_school_id,
    'query', left(coalesce(p_query, ''), 500),
    'mode', v_mode,
    'vector_attempted', v_vector_attempted,
    'min_score', p_min_score,
    'role', v_role,
    'hits', coalesce(v_rows, '[]'::jsonb),
    'hit_count', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)),
    'approved_only', true
  );
END;
$function$;
