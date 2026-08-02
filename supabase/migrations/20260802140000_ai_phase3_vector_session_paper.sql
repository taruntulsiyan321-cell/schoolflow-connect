-- Phase 3 continued (SSOT):
-- Vector Retrieval v0 (pgvector when available, else document-compatible real[]),
-- embedding job stub queue, AI Session Memory v1, teacher paper plan dry-run seed.
-- Roles: admin | teacher | student | parent | principal only — NEVER super_admin.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Optional pgvector (safe if unavailable)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable — using embedding_compat real[] only (%)', SQLERRM;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. KMS chunk embedding columns + job queue
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ai_kms_chunks
  ADD COLUMN IF NOT EXISTS embed_status text NOT NULL DEFAULT 'deferred',
  ADD COLUMN IF NOT EXISTS embedding_compat real[],
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_kms_chunks_embed_status_check'
  ) THEN
    ALTER TABLE public.ai_kms_chunks
      ADD CONSTRAINT ai_kms_chunks_embed_status_check
      CHECK (embed_status IN ('pending_embed', 'embedded', 'deferred', 'failed'));
  END IF;
END $$;

-- Native vector column when extension present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ai_kms_chunks'
        AND column_name = 'embedding'
    ) THEN
      EXECUTE 'ALTER TABLE public.ai_kms_chunks ADD COLUMN embedding vector(1536)';
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_kms_chunks_embed_status
  ON public.ai_kms_chunks (embed_status)
  WHERE embed_status IN ('pending_embed', 'failed');

CREATE INDEX IF NOT EXISTS ai_kms_chunks_published_embed
  ON public.ai_kms_chunks (published, embed_status)
  WHERE published = true;

-- Expand version embedding_status to include pending_embed / embedded aliases
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'ai_kms_document_versions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%embedding_status%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ai_kms_document_versions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.ai_kms_document_versions
  DROP CONSTRAINT IF EXISTS ai_kms_document_versions_embedding_status_check;

ALTER TABLE public.ai_kms_document_versions
  ADD CONSTRAINT ai_kms_document_versions_embedding_status_check
  CHECK (embedding_status IN (
    'pending', 'stub', 'ready', 'failed', 'pending_embed', 'embedded', 'deferred'
  ));

CREATE TABLE IF NOT EXISTS public.ai_embedding_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES public.ai_kms_chunks(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.ai_kms_documents(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.ai_kms_document_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_embed'
    CHECK (status IN ('pending_embed', 'processing', 'embedded', 'deferred', 'failed')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  provider_hint text NOT NULL DEFAULT 'unset'
    CHECK (provider_hint IN ('unset', 'openrouter', 'openai', 'other')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_embedding_jobs_chunk UNIQUE (chunk_id)
);

CREATE INDEX IF NOT EXISTS ai_embedding_jobs_status
  ON public.ai_embedding_jobs (status, created_at)
  WHERE status IN ('pending_embed', 'failed');

ALTER TABLE public.ai_embedding_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_embedding_jobs staff read" ON public.ai_embedding_jobs;
CREATE POLICY "ai_embedding_jobs staff read" ON public.ai_embedding_jobs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'teacher'::public.app_role)
      AND public.same_school(school_id)
    )
  );

GRANT SELECT ON public.ai_embedding_jobs TO authenticated;
GRANT ALL ON public.ai_embedding_jobs TO service_role;

-- Cosine similarity for document-compatible real[] embeddings
CREATE OR REPLACE FUNCTION public.ai_cosine_similarity(a real[], b real[])
RETURNS real
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  n int;
  i int;
  dot double precision := 0;
  na double precision := 0;
  nb double precision := 0;
BEGIN
  n := LEAST(coalesce(array_length(a, 1), 0), coalesce(array_length(b, 1), 0));
  IF n < 1 THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. n LOOP
    dot := dot + (a[i]::double precision * b[i]::double precision);
    na := na + (a[i]::double precision * a[i]::double precision);
    nb := nb + (b[i]::double precision * b[i]::double precision);
  END LOOP;
  IF na <= 0 OR nb <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN (dot / (sqrt(na) * sqrt(nb)))::real;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_cosine_similarity(real[], real[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_cosine_similarity(real[], real[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_cosine_similarity(real[], real[]) TO service_role;

-- Lexical overlap score (0..1) — safe degrade when embeddings unset
CREATE OR REPLACE FUNCTION public.ai_lexical_overlap(query text, body text)
RETURNS real
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  q text[];
  t text;
  hits int := 0;
  total int := 0;
  hay text;
BEGIN
  hay := lower(coalesce(body, ''));
  q := regexp_split_to_array(lower(trim(coalesce(query, ''))), '\s+');
  IF q IS NULL OR array_length(q, 1) IS NULL THEN
    RETURN 0;
  END IF;
  FOREACH t IN ARRAY q LOOP
    IF length(t) < 2 THEN
      CONTINUE;
    END IF;
    total := total + 1;
    IF position(t IN hay) > 0 THEN
      hits := hits + 1;
    END IF;
  END LOOP;
  IF total = 0 THEN
    RETURN 0;
  END IF;
  RETURN (hits::real / total::real);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_lexical_overlap(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_lexical_overlap(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_lexical_overlap(text, text) TO service_role;

-- Mark published chunks pending embed + enqueue jobs (no external call)
CREATE OR REPLACE FUNCTION public.ai_kms_enqueue_embedding_jobs(
  p_document_id uuid,
  p_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_doc public.ai_kms_documents%ROWTYPE;
  v_vid uuid;
  v_n int := 0;
BEGIN
  v_uid := public.ai_kms_assert_staff();

  SELECT * INTO v_doc FROM public.ai_kms_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document not found'; END IF;
  IF NOT public.same_school(v_doc.school_id)
     AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorised for school';
  END IF;

  IF p_version IS NULL THEN
    SELECT id INTO v_vid
      FROM public.ai_kms_document_versions
     WHERE document_id = p_document_id
     ORDER BY version DESC
     LIMIT 1;
  ELSE
    SELECT id INTO v_vid
      FROM public.ai_kms_document_versions
     WHERE document_id = p_document_id AND version = p_version;
  END IF;
  IF v_vid IS NULL THEN RAISE EXCEPTION 'version not found'; END IF;

  UPDATE public.ai_kms_chunks c
     SET embed_status = 'pending_embed',
         embedding_stub = jsonb_build_object('status', 'pending_embed', 'dims', 0)
   WHERE c.version_id = v_vid
     AND c.published = true
     AND c.embed_status IS DISTINCT FROM 'embedded';

  INSERT INTO public.ai_embedding_jobs (
    school_id, chunk_id, document_id, version_id, status, provider_hint, metadata
  )
  SELECT
    v_doc.school_id,
    c.id,
    c.document_id,
    c.version_id,
    'pending_embed',
    'unset',
    jsonb_build_object('enqueued_by', v_uid)
  FROM public.ai_kms_chunks c
  WHERE c.version_id = v_vid
    AND c.published = true
  ON CONFLICT (chunk_id) DO UPDATE
    SET status = CASE
          WHEN public.ai_embedding_jobs.status = 'embedded' THEN public.ai_embedding_jobs.status
          ELSE 'pending_embed'
        END,
        updated_at = now(),
        last_error = NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.ai_kms_document_versions
     SET embedding_status = 'pending_embed'
   WHERE id = v_vid
     AND embedding_status IS DISTINCT FROM 'embedded';

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'version_id', v_vid,
    'jobs_touched', v_n,
    'status', 'pending_embed',
    'note', 'No external embedding call — worker may defer when provider unset'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_kms_enqueue_embedding_jobs(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_kms_enqueue_embedding_jobs(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_enqueue_embedding_jobs(uuid, int) TO service_role;

-- Safe degrade: mark pending jobs deferred when embedding provider unset
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
  IF auth.uid() IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
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
GRANT EXECUTE ON FUNCTION public.ai_kms_defer_unset_embeddings(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_defer_unset_embeddings(int) TO service_role;

-- Complete a single chunk embed (service/worker). Accepts real[] compat; vector when present.
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
  v_uid uuid := auth.uid();
  v_chunk public.ai_kms_chunks%ROWTYPE;
  v_has_vector boolean := EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector');
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF current_user <> 'service_role' THEN
    PERFORM public.ai_kms_assert_staff();
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

  -- Mirror into native vector column when extension + dims allow
  IF v_has_vector AND coalesce(array_length(p_embedding, 1), 0) = 1536 THEN
    BEGIN
      EXECUTE
        'UPDATE public.ai_kms_chunks SET embedding = $1::vector WHERE id = $2'
        USING ('[' || array_to_string(p_embedding, ',') || ']'), p_chunk_id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- embedding_compat remains source of truth
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
GRANT EXECUTE ON FUNCTION public.ai_kms_complete_chunk_embed(uuid, real[], text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_kms_complete_chunk_embed(uuid, real[], text, boolean, text) TO service_role;

-- Similarity / lexical retrieval over published approved KMS chunks only
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
  v_role text := lower(coalesce(nullif(trim(p_role), ''), 'student'));
  v_rows jsonb := '[]'::jsonb;
  v_mode text := 'lexical';
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_role NOT IN ('admin', 'teacher', 'student', 'parent', 'principal') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  IF current_user <> 'service_role' THEN
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
-- 2. AI Session Memory v1 (workflow-scoped, not unrestricted chat)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_session_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL
    CHECK (actor_role IN ('admin', 'teacher', 'student', 'parent', 'principal')),
  workflow_scope text NOT NULL
    CHECK (workflow_scope IN (
      'tutoring', 'paper_gen', 'parent_guidance', 'principal_analytics'
    )),
  capability_id text,
  workflow_id text,
  target_student_id uuid,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'expired')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  turn_count int NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_session_memory_actor_active
  ON public.ai_session_memory (actor_user_id, workflow_scope, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ai_session_memory_school_scope
  ON public.ai_session_memory (school_id, workflow_scope, created_at DESC);

ALTER TABLE public.ai_session_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_session_memory own read" ON public.ai_session_memory;
CREATE POLICY "ai_session_memory own read" ON public.ai_session_memory
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
  );

DROP POLICY IF EXISTS "ai_session_memory own write" ON public.ai_session_memory;
CREATE POLICY "ai_session_memory own write" ON public.ai_session_memory
  FOR ALL TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    actor_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

GRANT SELECT, INSERT, UPDATE ON public.ai_session_memory TO authenticated;
GRANT ALL ON public.ai_session_memory TO service_role;

CREATE OR REPLACE FUNCTION public.ai_session_memory_open(
  p_school_id uuid,
  p_workflow_scope text,
  p_capability_id text DEFAULT NULL,
  p_workflow_id text DEFAULT NULL,
  p_target_student_id uuid DEFAULT NULL,
  p_ttl_minutes int DEFAULT 120,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid;
  v_ttl int := greatest(5, least(coalesce(p_ttl_minutes, 120), 24 * 60));
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_workflow_scope NOT IN ('tutoring', 'paper_gen', 'parent_guidance', 'principal_analytics') THEN
    RAISE EXCEPTION 'invalid workflow_scope';
  END IF;

  -- Resolve role (never super_admin)
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN v_role := 'admin';
  ELSIF public.has_role(v_uid, 'principal'::public.app_role) THEN v_role := 'principal';
  ELSIF public.has_role(v_uid, 'teacher'::public.app_role) THEN v_role := 'teacher';
  ELSIF public.has_role(v_uid, 'student'::public.app_role) THEN v_role := 'student';
  ELSIF public.has_role(v_uid, 'parent'::public.app_role) THEN v_role := 'parent';
  ELSIF current_user = 'service_role' THEN
    v_role := 'admin';
    v_uid := coalesce(v_uid, '00000000-0000-0000-0000-000000000001'::uuid);
  ELSE
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF NOT public.same_school(p_school_id)
     AND NOT public.has_role(v_uid, 'admin'::public.app_role)
     AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authorised for school';
  END IF;

  -- Close prior active session for same actor+scope (single short window)
  UPDATE public.ai_session_memory
     SET status = 'closed',
         closed_at = now(),
         updated_at = now()
   WHERE actor_user_id = v_uid
     AND workflow_scope = p_workflow_scope
     AND status = 'active';

  INSERT INTO public.ai_session_memory (
    school_id, actor_user_id, actor_role, workflow_scope,
    capability_id, workflow_id, target_student_id, summary, expires_at
  ) VALUES (
    p_school_id, v_uid, v_role, p_workflow_scope,
    p_capability_id, p_workflow_id, p_target_student_id,
    coalesce(p_summary, '{}'::jsonb),
    now() + make_interval(mins => v_ttl)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'session_id', v_id,
    'workflow_scope', p_workflow_scope,
    'status', 'active',
    'expires_at', (now() + make_interval(mins => v_ttl))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_open(uuid, text, text, text, uuid, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_open(uuid, text, text, text, uuid, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_open(uuid, text, text, text, uuid, int, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_session_memory_read(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ai_session_memory%ROWTYPE;
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.ai_session_memory WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF current_user <> 'service_role'
     AND r.actor_user_id IS DISTINCT FROM v_uid
     AND NOT public.has_role(v_uid, 'admin'::public.app_role)
     AND NOT public.has_role(v_uid, 'principal'::public.app_role) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF r.status = 'active' AND r.expires_at < now() THEN
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

CREATE OR REPLACE FUNCTION public.ai_session_memory_append(
  p_session_id uuid,
  p_summary_patch jsonb DEFAULT '{}'::jsonb,
  p_increment_turn boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ai_session_memory%ROWTYPE;
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.ai_session_memory WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;

  IF current_user <> 'service_role'
     AND r.actor_user_id IS DISTINCT FROM v_uid
     AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF r.status <> 'active' OR r.expires_at < now() THEN
    RAISE EXCEPTION 'session not active';
  END IF;

  -- Merge structured summary only (never unrestricted chat transcripts)
  UPDATE public.ai_session_memory
     SET summary = coalesce(summary, '{}'::jsonb) || coalesce(p_summary_patch, '{}'::jsonb),
         turn_count = turn_count + CASE WHEN p_increment_turn THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE id = p_session_id
  RETURNING * INTO r;

  RETURN jsonb_build_object(
    'session_id', r.id,
    'status', r.status,
    'turn_count', r.turn_count,
    'summary', r.summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_append(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_append(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_append(uuid, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_session_memory_close(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.ai_session_memory
     SET status = 'closed',
         closed_at = now(),
         updated_at = now()
   WHERE id = p_session_id
     AND (
       actor_user_id = v_uid
       OR public.has_role(v_uid, 'admin'::public.app_role)
       OR current_user = 'service_role'
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not authorised';
  END IF;

  RETURN jsonb_build_object('session_id', p_session_id, 'status', 'closed');
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_close(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_close(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_close(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Teacher paper plan dry-run workflow seed (enabled — plan only)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'teacher.question_paper.plan.v1',
  'v1',
  'teacher.question_paper.plan',
  true,
  jsonb_build_object(
    'note', 'Dry-run planner — returns curriculum weight plan; does not generate full paper',
    'steps', jsonb_build_array(
      'permission_purpose',
      'assemble_spec',
      'compute_weights',
      'emit_plan',
      'session_checkpoint'
    )
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET capability_id = EXCLUDED.capability_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now();

-- Keep full generate workflow disabled
INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'teacher.question_paper.v1',
  'v1',
  'teacher.question_paper.generate',
  false,
  jsonb_build_object(
    'note', 'Full Qwen paper generation deferred',
    'related_plan_workflow', 'teacher.question_paper.plan.v1'
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET metadata = coalesce(public.ai_workflow_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      updated_at = now();
