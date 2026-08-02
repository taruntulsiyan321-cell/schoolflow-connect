-- Repair: AI Phase 2 foundations used invalid app_role 'super_admin'.
-- Live enum labels: admin, teacher, student, parent, principal
-- (super_admin was reserved in a DO-block but is not present on applied DBs / generated types).
-- Safe if 20260802110000 partially applied or never applied: IF NOT EXISTS + DROP POLICY IF EXISTS.
-- Also rewrites ai_analytics_summary_v1 from 20260802100000 to drop super_admin.

-- ── Fix analytics RPC role gate (Phase 1) ─────────────────────────────────────
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

-- ── Prompt Library (idempotent Phase 2) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_prompt_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'shadow', 'production', 'retired')),
  audience text NOT NULL DEFAULT 'student'
    CHECK (audience IN ('student', 'teacher', 'parent', 'principal', 'admin', 'platform')),
  system_template text NOT NULL,
  user_template text NOT NULL DEFAULT '',
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_output_tokens int NOT NULL DEFAULT 250 CHECK (max_output_tokens > 0 AND max_output_tokens <= 8000),
  temperature numeric NOT NULL DEFAULT 0.2,
  caching_eligible boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_library_cap_ver UNIQUE (capability_id, version)
);

CREATE INDEX IF NOT EXISTS ai_prompt_library_cap_status
  ON public.ai_prompt_library (capability_id, status);

ALTER TABLE public.ai_prompt_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_prompt_library read admin" ON public.ai_prompt_library;
CREATE POLICY "ai_prompt_library read admin" ON public.ai_prompt_library
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
  );

DROP POLICY IF EXISTS "ai_prompt_library write admin" ON public.ai_prompt_library;
CREATE POLICY "ai_prompt_library write admin" ON public.ai_prompt_library
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
  );

GRANT SELECT ON public.ai_prompt_library TO authenticated;
GRANT ALL ON public.ai_prompt_library TO service_role;

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
SELECT v.capability_id, v.version, v.status, v.audience, v.system_template, v.user_template,
       v.output_schema::jsonb, v.max_output_tokens, v.temperature, v.caching_eligible, v.metadata::jsonb
FROM (VALUES
  (
    'student.performance.explain',
    'v1',
    'production',
    'student',
    'You explain Gurukul Academic Engine and Educational Intelligence facts only. Never invent numbers, mastery scores, attendance, or marks. If a figure is missing, say it is unavailable. Keep under 120 words. Encourage without shaming.',
    'Facts JSON:\n{{facts}}\n\nWrite a short plain-language performance summary.',
    '{"type":"plain_text","max_words":120}',
    250,
    0.1,
    true,
    '{"source":"ssot_phase1"}'
  ),
  (
    'student.concept.explain',
    'v1',
    'production',
    'student',
    'You explain one school concept using only the provided Educational Intelligence and Academic Engine facts. Never invent mastery percentages or exam scores. Prefer stepwise guidance over answer dumping. Keep under 150 words.',
    'Concept facts JSON:\n{{facts}}\n\nStudent question: {{question}}\n\nExplain the concept briefly using only these facts.',
    '{"type":"plain_text","max_words":150}',
    300,
    0.15,
    true,
    '{"source":"ssot_phase1"}'
  ),
  (
    'student.recommendation.explain',
    'v1',
    'production',
    'student',
    'You rephrase a deterministic recommendation package. Never change the recommended concept, priority order, or invent new metrics. Keep under 80 words. Task-focused, no shaming.',
    'Recommendation package JSON:\n{{facts}}\n\nWrite a short encouraging rationale for why this next step makes sense.',
    '{"type":"plain_text","max_words":80}',
    200,
    0.1,
    true,
    '{"source":"ssot_phase2"}'
  )
) AS v(capability_id, version, status, audience, system_template, user_template, output_schema, max_output_tokens, temperature, caching_eligible, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_prompt_library p
  WHERE p.capability_id = v.capability_id AND p.version = v.version
);

CREATE OR REPLACE FUNCTION public.ai_prompt_load_production(p_capability_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT capability_id, version, status, audience, system_template, user_template,
         output_schema, max_output_tokens, temperature, caching_eligible, metadata
    INTO r
  FROM public.ai_prompt_library
  WHERE capability_id = p_capability_id AND status = 'production'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'capability_id', r.capability_id,
    'version', r.version,
    'status', r.status,
    'audience', r.audience,
    'system_template', r.system_template,
    'user_template', r.user_template,
    'output_schema', r.output_schema,
    'max_output_tokens', r.max_output_tokens,
    'temperature', r.temperature,
    'caching_eligible', r.caching_eligible,
    'metadata', r.metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_prompt_load_production(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_prompt_load_production(text) TO service_role;

-- ── AI Feedback Loop signals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_feedback_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text,
  school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  actor_user_id uuid,
  actor_role text,
  feature_id text,
  signal_type text NOT NULL
    CHECK (signal_type IN (
      'like', 'dislike', 'useful', 'not_useful', 'accept', 'reject',
      'edit', 'retry', 'dismiss', 'complete', 'show_full_solution', 'correction'
    )),
  target_kind text NOT NULL DEFAULT 'response'
    CHECK (target_kind IN ('response', 'recommendation', 'artifact', 'prompt')),
  target_ref text,
  rating smallint CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  comment_redacted text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_feedback_signals_school_created
  ON public.ai_feedback_signals (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_feedback_signals_feature_type
  ON public.ai_feedback_signals (feature_id, signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_feedback_signals_request
  ON public.ai_feedback_signals (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.ai_feedback_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_feedback insert own" ON public.ai_feedback_signals;
CREATE POLICY "ai_feedback insert own" ON public.ai_feedback_signals
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

DROP POLICY IF EXISTS "ai_feedback read own or admin" ON public.ai_feedback_signals;
CREATE POLICY "ai_feedback read own or admin" ON public.ai_feedback_signals
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
  );

GRANT SELECT, INSERT ON public.ai_feedback_signals TO authenticated;
GRANT ALL ON public.ai_feedback_signals TO service_role;

-- ── Workflow registry ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_workflow_registry (
  workflow_id text PRIMARY KEY,
  version text NOT NULL,
  capability_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_workflow_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_workflow_registry read admin" ON public.ai_workflow_registry;
CREATE POLICY "ai_workflow_registry read admin" ON public.ai_workflow_registry
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
  );

GRANT SELECT ON public.ai_workflow_registry TO authenticated;
GRANT ALL ON public.ai_workflow_registry TO service_role;

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'teacher.question_paper.v1',
  'v1',
  'teacher.question_paper.generate',
  false,
  '{"note":"Skeleton only — full pipeline deferred","steps":["spec","cache_lookup","generate","validate","teacher_review"]}'::jsonb
)
ON CONFLICT (workflow_id) DO NOTHING;
