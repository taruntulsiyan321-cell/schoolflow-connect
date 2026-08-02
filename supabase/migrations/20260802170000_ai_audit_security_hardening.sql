-- AI audit hardening (post Phase 3):
-- 1) Bind KMS retrieve role to caller's real app_role (no client spoof)
-- 2) Tenant-gate KMS reject (mirror approve); no school-admin cross-tenant bypass
-- 3) Embedding batch / defer / complete — service_role only
-- 4) Tighten ai_explanations INSERT
-- 5) Fix digest() search_path on KMS submit
-- 6) GRANT write on kill-switch + budget quota tables; tenant-gate principal RLS
-- 7) Tenant-gate control-plane SELECT policies (decisions/cache/explanations/sessions/feedback)
-- 8) Analytics summary + prompt promote server-side gates
-- 9) Session memory read VOLATILE (expires via UPDATE)
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
    -- School-bound admin/principal must stay in-tenant (no cross-school bypass).
    IF NOT public.same_school(p_school_id) THEN
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

  IF NOT public.same_school(v_doc.school_id) THEN
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
  IF NOT public.same_school(v_doc.school_id) THEN
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
-- 6. Kill-switch + budget quota writes — match RLS; tenant-gate principal
-- ═══════════════════════════════════════════════════════════════════════════

-- Global flags (school_id IS NULL): service_role only (RLS bypass).
-- School-scoped overrides: same-school admin or principal.
DROP POLICY IF EXISTS "ai_flags write admin" ON public.ai_feature_flags;
CREATE POLICY "ai_flags write admin" ON public.ai_feature_flags
  FOR ALL TO authenticated
  USING (
    school_id IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
    AND public.same_school(school_id)
  )
  WITH CHECK (
    school_id IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "ai_flags read authenticated" ON public.ai_feature_flags;
CREATE POLICY "ai_flags read authenticated" ON public.ai_feature_flags
  FOR SELECT TO authenticated
  USING (
    school_id IS NULL
    OR school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
    OR (
      (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "ai_budget_quotas write admin" ON public.ai_budget_quotas;
CREATE POLICY "ai_budget_quotas write admin" ON public.ai_budget_quotas
  FOR ALL TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
    AND public.same_school(school_id)
  )
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "ai_budget_quotas read school" ON public.ai_budget_quotas;
CREATE POLICY "ai_budget_quotas read school" ON public.ai_budget_quotas
  FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
    OR (
      (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_budget_quotas TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Tenant-gate AI control-plane SELECT policies (admin/principal)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "ai_decisions read own school" ON public.ai_request_decisions;
CREATE POLICY "ai_decisions read own school" ON public.ai_request_decisions
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR (
      school_id IS NOT NULL
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "ai_solution_cache read tenant" ON public.ai_solution_cache;
CREATE POLICY "ai_solution_cache read tenant" ON public.ai_solution_cache
  FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
    OR (
      (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "ai_expl read tenant" ON public.ai_explanations;
CREATE POLICY "ai_expl read tenant" ON public.ai_explanations
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      school_id IS NOT NULL
      AND school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    )
    OR (
      school_id IS NOT NULL
      AND school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    )
    OR (
      school_id IS NOT NULL
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "ai_budget_usage read admin" ON public.ai_budget_usage;
CREATE POLICY "ai_budget_usage read admin" ON public.ai_budget_usage
  FOR SELECT TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "ai_session_memory own read" ON public.ai_session_memory;
CREATE POLICY "ai_session_memory own read" ON public.ai_session_memory
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR (
      (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "ai_feedback read own or admin" ON public.ai_feedback_signals;
CREATE POLICY "ai_feedback read own or admin" ON public.ai_feedback_signals
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR (
      school_id IS NOT NULL
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "ai_feedback insert own" ON public.ai_feedback_signals;
CREATE POLICY "ai_feedback insert own" ON public.ai_feedback_signals
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (
      school_id IS NULL
      OR public.same_school(school_id)
    )
  );

-- Embedding jobs: staff read only same school
DROP POLICY IF EXISTS "ai_embedding_jobs staff read" ON public.ai_embedding_jobs;
CREATE POLICY "ai_embedding_jobs staff read" ON public.ai_embedding_jobs
  FOR SELECT TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    )
    AND public.same_school(school_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. ai_kms_complete_chunk_embed — service_role only
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_kms_complete_chunk_embed(
  p_chunk_id uuid,
  p_embedding real[] DEFAULT NULL,
  p_model_version text DEFAULT NULL,
  p_failed boolean DEFAULT false,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chunk public.ai_kms_chunks%ROWTYPE;
  v_has_vector boolean := EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector');
BEGIN
  IF current_user <> 'service_role' AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role only';
  END IF;

  SELECT * INTO v_chunk FROM public.ai_kms_chunks WHERE id = p_chunk_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chunk not found'; END IF;

  IF p_failed OR p_embedding IS NULL THEN
    UPDATE public.ai_kms_chunks
       SET embed_status = CASE WHEN p_failed THEN 'failed' ELSE 'deferred' END,
           embedding_stub = jsonb_build_object(
             'status', CASE WHEN p_failed THEN 'failed' ELSE 'deferred' END,
             'dims', 0,
             'error', left(coalesce(p_error, 'no embedding vector supplied'), 200)
           )
     WHERE id = p_chunk_id;

    UPDATE public.ai_embedding_jobs
       SET status = CASE WHEN p_failed THEN 'failed' ELSE 'deferred' END,
           last_error = left(coalesce(p_error, 'no embedding vector supplied'), 500),
           updated_at = now(),
           completed_at = now(),
           attempts = attempts + 1
     WHERE chunk_id = p_chunk_id;

    RETURN jsonb_build_object(
      'chunk_id', p_chunk_id,
      'embed_status', CASE WHEN p_failed THEN 'failed' ELSE 'deferred' END,
      'safe_degrade', true
    );
  END IF;

  UPDATE public.ai_kms_chunks
     SET embed_status = 'embedded',
         embedding_compat = p_embedding,
         embedding_model_version = coalesce(p_model_version, embedding_model_version, 'compat-v0'),
         embedded_at = now(),
         embedding_stub = jsonb_build_object(
           'status', 'embedded',
           'dims', coalesce(array_length(p_embedding, 1), 0)
         )
   WHERE id = p_chunk_id;

  IF v_has_vector AND coalesce(array_length(p_embedding, 1), 0) = 1536 THEN
    BEGIN
      EXECUTE
        'UPDATE public.ai_kms_chunks SET embedding = $1::vector WHERE id = $2'
        USING ('[' || array_to_string(p_embedding, ',') || ']'), p_chunk_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  UPDATE public.ai_embedding_jobs
     SET status = 'embedded',
         updated_at = now(),
         completed_at = now(),
         attempts = attempts + 1,
         last_error = NULL
   WHERE chunk_id = p_chunk_id;

  RETURN jsonb_build_object(
    'chunk_id', p_chunk_id,
    'embed_status', 'embedded',
    'dims', coalesce(array_length(p_embedding, 1), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_kms_complete_chunk_embed(uuid, real[], text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_kms_complete_chunk_embed(uuid, real[], text, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_complete_chunk_embed(uuid, real[], text, boolean, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. ai_analytics_summary_v1 — require same_school
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_analytics_summary_v1(
  p_school_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
  v_model int := 0;
  v_cache int := 0;
  v_conf_sum numeric := 0;
  v_conf_n int := 0;
  v_low_conf int := 0;
  v_lat_sum numeric := 0;
  v_lat_n int := 0;
  v_cost numeric := 0;
  v_route jsonb := '{}'::jsonb;
  v_decision jsonb := '{}'::jsonb;
  v_feature jsonb := '{}'::jsonb;
  r record;
  v_is_service boolean := (
    current_user = 'service_role' OR coalesce(auth.role(), '') = 'service_role'
  );
BEGIN
  IF NOT v_is_service THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated';
    END IF;
    IF NOT (
      public.has_role(v_uid, 'admin'::public.app_role)
      OR public.has_role(v_uid, 'principal'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
    IF NOT public.same_school(p_school_id) THEN
      RAISE EXCEPTION 'not authorised for school';
    END IF;
  END IF;

  FOR r IN
    SELECT feature_id, route_class, decision, used_model, cache_hit, confidence, latency_ms,
           coalesce(estimated_cost_units, 0) AS cost_units
    FROM public.ai_request_decisions
    WHERE school_id = p_school_id
      AND created_at >= coalesce(p_from, now() - interval '7 days')
      AND created_at <= coalesce(p_to, now())
  LOOP
    v_count := v_count + 1;
    IF r.used_model THEN v_model := v_model + 1; END IF;
    IF r.cache_hit THEN v_cache := v_cache + 1; END IF;
    IF r.confidence IS NOT NULL THEN
      v_conf_sum := v_conf_sum + r.confidence;
      v_conf_n := v_conf_n + 1;
      IF r.confidence < 0.65 THEN v_low_conf := v_low_conf + 1; END IF;
    END IF;
    IF r.latency_ms IS NOT NULL THEN
      v_lat_sum := v_lat_sum + r.latency_ms;
      v_lat_n := v_lat_n + 1;
    END IF;
    IF r.used_model THEN
      v_cost := v_cost + GREATEST(r.cost_units, 1);
    ELSE
      v_cost := v_cost + r.cost_units;
    END IF;

    v_route := jsonb_set(
      v_route,
      ARRAY[coalesce(r.route_class, 'unknown')],
      to_jsonb(coalesce((v_route ->> coalesce(r.route_class, 'unknown'))::int, 0) + 1)
    );
    v_decision := jsonb_set(
      v_decision,
      ARRAY[coalesce(r.decision, 'unknown')],
      to_jsonb(coalesce((v_decision ->> coalesce(r.decision, 'unknown'))::int, 0) + 1)
    );
    v_feature := jsonb_set(
      v_feature,
      ARRAY[coalesce(r.feature_id, 'unknown')],
      to_jsonb(coalesce((v_feature ->> coalesce(r.feature_id, 'unknown'))::int, 0) + 1)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'window', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'count', v_count
    ),
    'route_mix', v_route,
    'decision_mix', v_decision,
    'feature_mix', v_feature,
    'model_calls', v_model,
    'cache_hits', v_cache,
    'deflection_pct', CASE WHEN v_count = 0 THEN 0
      ELSE round(((v_count - v_model)::numeric / v_count) * 1000) / 10 END,
    'avg_confidence', CASE WHEN v_conf_n = 0 THEN NULL
      ELSE round((v_conf_sum / v_conf_n) * 1000) / 1000 END,
    'avg_latency_ms', CASE WHEN v_lat_n = 0 THEN NULL ELSE round(v_lat_sum / v_lat_n) END,
    'estimated_cost_units', v_cost,
    'low_confidence_rate', CASE WHEN v_conf_n = 0 THEN NULL
      ELSE round((v_low_conf::numeric / v_conf_n) * 1000) / 1000 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_analytics_summary_v1(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_analytics_summary_v1(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_analytics_summary_v1(uuid, timestamptz, timestamptz) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. ai_prompt_promote — server-side benchmark gate (no client forge)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_prompt_promote(
  p_capability_id text,
  p_version text,
  p_to_status text,
  p_rollback_version text DEFAULT NULL,
  p_benchmark_run_ids uuid[] DEFAULT NULL,
  p_scorecard jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ai_prompt_library%ROWTYPE;
  v_from text;
  v_gate jsonb;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_role(v_uid, 'principal'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF p_to_status NOT IN ('draft', 'offline_benchmark', 'shadow', 'ab_test', 'production', 'retired') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT * INTO v_row
    FROM public.ai_prompt_library
   WHERE capability_id = p_capability_id AND version = p_version
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prompt version not found';
  END IF;

  v_from := v_row.status;

  IF NOT (
    (v_from = 'draft' AND p_to_status IN ('offline_benchmark', 'retired'))
    OR (v_from = 'offline_benchmark' AND p_to_status IN ('shadow', 'draft', 'retired'))
    OR (v_from = 'shadow' AND p_to_status IN ('ab_test', 'offline_benchmark', 'retired'))
    OR (v_from = 'ab_test' AND p_to_status IN ('production', 'shadow', 'retired'))
    OR (v_from = 'production' AND p_to_status IN ('retired', 'shadow'))
    OR (v_from = 'retired' AND p_to_status IN ('draft'))
  ) THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_from, p_to_status;
  END IF;

  IF p_to_status = 'production' THEN
    v_label := coalesce(
      nullif(trim(p_scorecard ->> 'candidate_label'), ''),
      p_capability_id || '@' || p_version
    );
    v_gate := public.ai_benchmark_gate_passed(v_label, NULL);
    IF NOT coalesce((v_gate ->> 'gate_passed')::boolean, false) THEN
      RAISE EXCEPTION 'production promotion blocked — benchmark gate not passed for %', v_label;
    END IF;

    IF p_benchmark_run_ids IS NOT NULL AND array_length(p_benchmark_run_ids, 1) IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
          FROM unnest(p_benchmark_run_ids) AS rid(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM public.ai_benchmark_runs br
            WHERE br.id = rid.id AND br.passed IS TRUE
         )
      ) THEN
        RAISE EXCEPTION 'production promotion blocked — invalid or failed benchmark_run_ids';
      END IF;
    END IF;

    UPDATE public.ai_prompt_library
       SET status = 'retired',
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('retired_for', p_version)
     WHERE capability_id = p_capability_id
       AND status = 'production'
       AND version IS DISTINCT FROM p_version;
  END IF;

  UPDATE public.ai_prompt_library
     SET status = p_to_status,
         rollback_version = coalesce(p_rollback_version, rollback_version),
         scorecard = coalesce(p_scorecard, scorecard) || CASE
           WHEN p_to_status = 'production' THEN jsonb_build_object('gate_passed', true, 'gate', v_gate)
           ELSE '{}'::jsonb
         END,
         benchmark_run_ids = coalesce(p_benchmark_run_ids, benchmark_run_ids),
         promoted_by = CASE WHEN p_to_status = 'production' THEN v_uid ELSE promoted_by END,
         promoted_at = CASE WHEN p_to_status = 'production' THEN now() ELSE promoted_at END,
         updated_at = now()
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'capability_id', p_capability_id,
    'version', p_version,
    'from_status', v_from,
    'to_status', p_to_status,
    'rollback_version', coalesce(p_rollback_version, v_row.rollback_version),
    'gate', v_gate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_prompt_promote(text, text, text, text, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_prompt_promote(text, text, text, text, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_prompt_promote(text, text, text, text, uuid[], jsonb) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Session memory read — VOLATILE (performs UPDATE on expire)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_session_memory_read(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ai_session_memory%ROWTYPE;
  v_is_service boolean := (
    current_user = 'service_role' OR coalesce(auth.role(), '') = 'service_role'
  );
BEGIN
  IF v_uid IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.ai_session_memory WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT v_is_service THEN
    IF r.actor_user_id IS DISTINCT FROM v_uid
       AND NOT (
         (public.has_role(v_uid, 'admin'::public.app_role)
          OR public.has_role(v_uid, 'principal'::public.app_role))
         AND public.same_school(r.school_id)
       ) THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
  END IF;

  IF r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now() THEN
    UPDATE public.ai_session_memory
       SET status = 'expired', updated_at = now()
     WHERE id = p_session_id;
    r.status := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'session_id', r.id,
    'school_id', r.school_id,
    'workflow_scope', r.workflow_scope,
    'capability_id', r.capability_id,
    'workflow_id', r.workflow_id,
    'target_student_id', r.target_student_id,
    'status', r.status,
    'summary', r.summary,
    'turn_count', r.turn_count,
    'expires_at', r.expires_at,
    'updated_at', r.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_read(uuid) TO service_role;
