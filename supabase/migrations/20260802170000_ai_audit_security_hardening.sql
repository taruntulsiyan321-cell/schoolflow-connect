-- AI audit hardening (post Phase 3):
-- 1) Bind KMS retrieve role to caller's real app_role (no client spoof)
-- 2) Tenant-gate KMS reject (mirror approve)
-- 3) Embedding batch / defer — service_role only
-- 4) Tighten ai_explanations INSERT
-- 5) Fix digest() search_path on KMS submit
-- 6) GRANT write on kill-switch + budget quota tables for admin policies
-- Roles: admin | teacher | student | parent | principal only — NEVER super_admin.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ai_kms_retrieve_chunks — bind role to get_my_role() for JWT callers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_kms_retrieve_chunks(
  p_school_id uuid,
  p_query text,
  p_role text DEFAULT 'student',
  p_limit int DEFAULT 5,
  p_min_score real DEFAULT 0.12,
  p_query_embedding real[] DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_grade text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 20));
  v_role text;
  v_rows jsonb := '[]'::jsonb;
  v_mode text := 'lexical';
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
    IF NOT public.same_school(p_school_id)
       AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'not authorised for school';
    END IF;
  END IF;

  IF p_query_embedding IS NOT NULL AND array_length(p_query_embedding, 1) IS NOT NULL THEN
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
    'min_score', p_min_score,
    'role', v_role,
    'hits', coalesce(v_rows, '[]'::jsonb),
    'hit_count', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)),
    'approved_only', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_kms_retrieve_chunks(uuid, text, text, int, real, real[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_kms_retrieve_chunks(uuid, text, text, int, real, real[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_retrieve_chunks(uuid, text, text, int, real, real[], text, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ai_kms_reject_version — same_school gate
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_kms_reject_version(
  p_document_id uuid,
  p_version int,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_doc public.ai_kms_documents%ROWTYPE;
  v_ver public.ai_kms_document_versions%ROWTYPE;
BEGIN
  v_uid := public.ai_kms_assert_staff();

  SELECT * INTO v_doc FROM public.ai_kms_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document not found'; END IF;

  IF NOT public.same_school(v_doc.school_id)
     AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorised for school';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_role(v_uid, 'principal'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'rejection requires admin or principal';
  END IF;

  SELECT * INTO v_ver
    FROM public.ai_kms_document_versions
   WHERE document_id = p_document_id AND version = p_version
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'version not found'; END IF;

  UPDATE public.ai_kms_document_versions
     SET approval_status = 'rejected',
         rejection_reason = left(coalesce(p_reason, ''), 500),
         approved_by = v_uid,
         approved_at = now()
   WHERE id = v_ver.id;

  UPDATE public.ai_kms_documents
     SET status = 'rejected', updated_at = now()
   WHERE id = p_document_id;

  INSERT INTO public.ai_kms_approval_audit (document_id, version_id, action, actor_user_id, detail)
  VALUES (
    p_document_id, v_ver.id, 'reject', v_uid,
    jsonb_build_object('version', p_version, 'reason', left(coalesce(p_reason, ''), 200))
  );

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'version', p_version,
    'status', 'rejected'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_kms_reject_version(uuid, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_kms_reject_version(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_reject_version(uuid, int, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Embedding batch / defer — service_role only
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_embedding_jobs_process_batch(
  p_limit int DEFAULT 10,
  p_provider_configured boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 50));
  v_deferred int := 0;
  v_jobs jsonb := '[]'::jsonb;
BEGIN
  IF current_user <> 'service_role' AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role only';
  END IF;

  IF NOT coalesce(p_provider_configured, false) THEN
    WITH picked AS (
      SELECT id
        FROM public.ai_embedding_jobs
       WHERE status IN ('pending_embed', 'failed', 'processing')
       ORDER BY created_at ASC
       LIMIT v_limit
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.ai_embedding_jobs j
       SET status = 'deferred',
           last_error = 'embedding provider unset — safe degrade',
           updated_at = now(),
           completed_at = now()
      FROM picked
     WHERE j.id = picked.id;

    GET DIAGNOSTICS v_deferred = ROW_COUNT;

    UPDATE public.ai_kms_chunks c
       SET embed_status = 'deferred',
           embedding_stub = jsonb_build_object(
             'status', 'deferred',
             'dims', 0,
             'reason', 'provider_unset'
           )
     WHERE c.id IN (
       SELECT chunk_id FROM public.ai_embedding_jobs
        WHERE status = 'deferred'
          AND updated_at >= now() - interval '2 seconds'
     );

    RETURN jsonb_build_object(
      'action', 'deferred',
      'provider_configured', false,
      'deferred_count', v_deferred,
      'jobs', '[]'::jsonb,
      'note', 'No external embedding call — set OPENROUTER_API_KEY or AI_EMBEDDING_API_KEY'
    );
  END IF;

  WITH picked AS (
    SELECT j.id
      FROM public.ai_embedding_jobs j
     WHERE j.status IN ('pending_embed', 'failed')
     ORDER BY j.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.ai_embedding_jobs j
       SET status = 'processing',
           attempts = j.attempts + 1,
           updated_at = now(),
           provider_hint = CASE
             WHEN j.provider_hint = 'unset' THEN 'openrouter'
             ELSE j.provider_hint
           END
      FROM picked
     WHERE j.id = picked.id
     RETURNING j.id, j.chunk_id, j.school_id, j.document_id, j.version_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'job_id', c.id,
        'chunk_id', c.chunk_id,
        'school_id', c.school_id,
        'document_id', c.document_id,
        'version_id', c.version_id,
        'chunk_text', left(coalesce(ch.chunk_text, ''), 8000)
      )
      ORDER BY c.id
    ),
    '[]'::jsonb
  )
  INTO v_jobs
  FROM claimed c
  JOIN public.ai_kms_chunks ch ON ch.id = c.chunk_id;

  RETURN jsonb_build_object(
    'action', 'claim',
    'provider_configured', true,
    'job_count', coalesce(jsonb_array_length(v_jobs), 0),
    'jobs', v_jobs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_kms_defer_unset_embeddings(
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  IF current_user <> 'service_role' AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role only';
  END IF;

  WITH claimed AS (
    SELECT id, chunk_id
      FROM public.ai_embedding_jobs
     WHERE status = 'pending_embed'
       AND provider_hint = 'unset'
     ORDER BY created_at
     LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
     FOR UPDATE SKIP LOCKED
  ),
  upd_jobs AS (
    UPDATE public.ai_embedding_jobs j
       SET status = 'deferred',
           updated_at = now(),
           completed_at = now(),
           last_error = 'embedding provider unset — safe degrade',
           metadata = coalesce(j.metadata, '{}'::jsonb) || jsonb_build_object('deferred', true)
      FROM claimed c
     WHERE j.id = c.id
    RETURNING j.chunk_id
  ),
  upd_chunks AS (
    UPDATE public.ai_kms_chunks c
       SET embed_status = 'deferred',
           embedding_stub = jsonb_build_object('status', 'deferred', 'dims', 0, 'reason', 'provider_unset')
      FROM upd_jobs u
     WHERE c.id = u.chunk_id
    RETURNING c.id
  )
  SELECT count(*)::int INTO v_n FROM upd_chunks;

  RETURN jsonb_build_object(
    'deferred_count', coalesce(v_n, 0),
    'mode', 'safe_degrade',
    'provider', 'unset'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_kms_defer_unset_embeddings(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_kms_defer_unset_embeddings(int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_defer_unset_embeddings(int) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ai_explanations INSERT — require own uid + tenant bind
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "ai_expl insert own" ON public.ai_explanations;
CREATE POLICY "ai_expl insert own" ON public.ai_explanations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      school_id IS NULL
      OR public.same_school(school_id)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. digest() search_path fix on KMS submit (signature unchanged)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_kms_submit_version(
  p_document_id uuid,
  p_raw_text text,
  p_source_uri text DEFAULT NULL,
  p_chunk_texts text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid;
  v_doc public.ai_kms_documents%ROWTYPE;
  v_ver int;
  v_vid uuid;
  v_hash text;
  v_i int;
  v_chunks int := 0;
BEGIN
  v_uid := public.ai_kms_assert_staff();

  SELECT * INTO v_doc FROM public.ai_kms_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document not found';
  END IF;
  IF NOT public.same_school(v_doc.school_id)
     AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorised for school';
  END IF;

  v_ver := v_doc.current_version + 1;
  v_hash := encode(digest(coalesce(p_raw_text, ''), 'sha256'), 'hex');

  INSERT INTO public.ai_kms_document_versions (
    document_id, version, source_uri, content_hash, raw_text,
    approval_status, embedding_status, created_by
  ) VALUES (
    p_document_id, v_ver, p_source_uri, v_hash, p_raw_text,
    'pending', 'stub', v_uid
  )
  RETURNING id INTO v_vid;

  IF p_chunk_texts IS NOT NULL AND array_length(p_chunk_texts, 1) IS NOT NULL THEN
    FOR v_i IN 1 .. array_length(p_chunk_texts, 1) LOOP
      INSERT INTO public.ai_kms_chunks (
        document_id, version_id, chunk_index, chunk_text, chunk_metadata, embedding_stub, published
      ) VALUES (
        p_document_id,
        v_vid,
        v_i - 1,
        p_chunk_texts[v_i],
        jsonb_build_object(
          'grade', v_doc.grade,
          'subject', v_doc.subject,
          'chapter', v_doc.chapter,
          'board', v_doc.board,
          'language', v_doc.language,
          'content_type', v_doc.content_type,
          'visibility_scope', to_jsonb(v_doc.visibility_scope)
        ),
        '{"status":"deferred","dims":0}'::jsonb,
        false
      );
      v_chunks := v_chunks + 1;
    END LOOP;
  ELSIF coalesce(trim(p_raw_text), '') <> '' THEN
    INSERT INTO public.ai_kms_chunks (
      document_id, version_id, chunk_index, chunk_text, chunk_metadata, embedding_stub, published
    ) VALUES (
      p_document_id, v_vid, 0, p_raw_text,
      jsonb_build_object(
        'grade', v_doc.grade,
        'subject', v_doc.subject,
        'content_type', v_doc.content_type
      ),
      '{"status":"deferred","dims":0}'::jsonb,
      false
    );
    v_chunks := 1;
  END IF;

  UPDATE public.ai_kms_document_versions
     SET chunk_count = v_chunks
   WHERE id = v_vid;

  UPDATE public.ai_kms_documents
     SET current_version = v_ver,
         status = 'pending_approval',
         updated_at = now()
   WHERE id = p_document_id;

  INSERT INTO public.ai_kms_approval_audit (document_id, version_id, action, actor_user_id, detail)
  VALUES (p_document_id, v_vid, 'submit', v_uid, jsonb_build_object('version', v_ver, 'chunks', v_chunks));

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'version_id', v_vid,
    'version', v_ver,
    'chunk_count', v_chunks,
    'embedding_status', 'stub',
    'approval_status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_kms_submit_version(uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_kms_submit_version(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_submit_version(uuid, text, text, text[]) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Kill-switch + budget quota writes — match existing RLS write policies
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_budget_quotas TO authenticated;
