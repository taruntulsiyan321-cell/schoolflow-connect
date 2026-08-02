-- AI control plane: request audit, kill switches / feature flags, tenant-scoped solution cache.
-- Hardens ai_explanations so it is not world-readable.

-- ── Feature flags / kill switches ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT ai_feature_flags_key_len CHECK (char_length(flag_key) BETWEEN 1 AND 128)
);

-- Global flags: school_id IS NULL. Per-tenant flags: school_id set.
CREATE UNIQUE INDEX IF NOT EXISTS ai_feature_flags_global_key
  ON public.ai_feature_flags (flag_key)
  WHERE school_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_feature_flags_school_key
  ON public.ai_feature_flags (school_id, flag_key)
  WHERE school_id IS NOT NULL;

ALTER TABLE public.ai_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_flags read authenticated" ON public.ai_feature_flags;
CREATE POLICY "ai_flags read authenticated" ON public.ai_feature_flags
  FOR SELECT TO authenticated
  USING (
    school_id IS NULL
    OR school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

DROP POLICY IF EXISTS "ai_flags write admin" ON public.ai_feature_flags;
CREATE POLICY "ai_flags write admin" ON public.ai_feature_flags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'));

GRANT SELECT ON public.ai_feature_flags TO authenticated;
GRANT ALL ON public.ai_feature_flags TO service_role;

-- Seed global kill switches (enabled = feature ON). Generative can be flipped off safely.
INSERT INTO public.ai_feature_flags (school_id, flag_key, enabled, metadata)
SELECT NULL, v.flag_key, true, v.metadata
FROM (VALUES
  ('ai.gateway.enabled', '{"description":"Master AI Gateway switch"}'::jsonb),
  ('ai.generative.enabled', '{"description":"OpenRouter/Qwen generative path"}'::jsonb),
  ('ai.deterministic.enabled', '{"description":"Deterministic AE/EIE paths"}'::jsonb)
) AS v(flag_key, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_feature_flags f
  WHERE f.school_id IS NULL AND f.flag_key = v.flag_key
);

-- ── Request decision audit ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_request_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL UNIQUE,
  school_id uuid,
  actor_user_id uuid,
  actor_role text,
  feature_id text NOT NULL,
  route_class text NOT NULL,
  decision text NOT NULL,
  used_model boolean NOT NULL DEFAULT false,
  model_id text,
  cache_hit boolean NOT NULL DEFAULT false,
  kill_switch_hit text,
  confidence numeric,
  latency_ms int,
  error_code text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_request_decisions_school_created
  ON public.ai_request_decisions (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_request_decisions_feature_created
  ON public.ai_request_decisions (feature_id, created_at DESC);

ALTER TABLE public.ai_request_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_decisions read own school" ON public.ai_request_decisions;
CREATE POLICY "ai_decisions read own school" ON public.ai_request_decisions
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

-- Inserts only via service role (gateway).
GRANT SELECT ON public.ai_request_decisions TO authenticated;
GRANT ALL ON public.ai_request_decisions TO service_role;

-- ── L2 solution cache (tenant-scoped) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_solution_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  feature_id text NOT NULL,
  student_id uuid,
  data_version text,
  payload jsonb NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_solution_cache_key_uniq UNIQUE (school_id, cache_key)
);

CREATE INDEX IF NOT EXISTS ai_solution_cache_lookup
  ON public.ai_solution_cache (school_id, feature_id, student_id);

ALTER TABLE public.ai_solution_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_solution_cache read tenant" ON public.ai_solution_cache;
CREATE POLICY "ai_solution_cache read tenant" ON public.ai_solution_cache
  FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

-- Writes via service role only.
GRANT SELECT ON public.ai_solution_cache TO authenticated;
GRANT ALL ON public.ai_solution_cache TO service_role;

-- ── Harden ai_explanations (add tenant + ownership; drop world-readable) ──────
ALTER TABLE public.ai_explanations
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "ai_expl read" ON public.ai_explanations;
DROP POLICY IF EXISTS "ai_expl insert" ON public.ai_explanations;

CREATE POLICY "ai_expl read tenant" ON public.ai_explanations
  FOR SELECT TO authenticated
  USING (
    (
      school_id IS NOT NULL AND (
        school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
        OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
        OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      )
    )
    OR (school_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "ai_expl insert own" ON public.ai_explanations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    OR created_by IS NULL
  );

GRANT SELECT, INSERT ON public.ai_explanations TO authenticated;
GRANT ALL ON public.ai_explanations TO service_role;
