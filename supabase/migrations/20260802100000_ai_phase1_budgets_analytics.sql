-- Phase 1 AI control plane: budget quotas, usage ledger, decision enrichments, analytics RPC.

-- ── Enrich ai_request_decisions ───────────────────────────────────────────────
ALTER TABLE public.ai_request_decisions
  ADD COLUMN IF NOT EXISTS budget_tier text,
  ADD COLUMN IF NOT EXISTS validation_ok boolean,
  ADD COLUMN IF NOT EXISTS estimated_cost_units numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS ai_request_decisions_school_feature_created
  ON public.ai_request_decisions (school_id, feature_id, created_at DESC);

-- ── Budget quotas (soft / hard limits per school or feature) ──────────────────
CREATE TABLE IF NOT EXISTS public.ai_budget_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('school', 'feature')),
  feature_id text,
  period text NOT NULL CHECK (period IN ('daily', 'monthly')),
  soft_limit_units int NOT NULL CHECK (soft_limit_units >= 0),
  hard_limit_units int CHECK (hard_limit_units IS NULL OR hard_limit_units >= soft_limit_units),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_budget_quotas_feature_scope CHECK (
    (scope = 'school' AND feature_id IS NULL)
    OR (scope = 'feature' AND feature_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_budget_quotas_school_scope
  ON public.ai_budget_quotas (school_id, scope, period)
  WHERE scope = 'school';

CREATE UNIQUE INDEX IF NOT EXISTS ai_budget_quotas_feature_scope
  ON public.ai_budget_quotas (school_id, feature_id, period)
  WHERE scope = 'feature';

ALTER TABLE public.ai_budget_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_budget_quotas read school" ON public.ai_budget_quotas;
CREATE POLICY "ai_budget_quotas read school" ON public.ai_budget_quotas
  FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT s.school_id FROM public.students s WHERE s.user_id = auth.uid())
    OR school_id IN (SELECT t.school_id FROM public.teachers t WHERE t.user_id = auth.uid())
    OR school_id IN (SELECT p.school_id FROM public.parents p WHERE p.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

DROP POLICY IF EXISTS "ai_budget_quotas write admin" ON public.ai_budget_quotas;
CREATE POLICY "ai_budget_quotas write admin" ON public.ai_budget_quotas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'));

GRANT SELECT ON public.ai_budget_quotas TO authenticated;
GRANT ALL ON public.ai_budget_quotas TO service_role;

-- ── Usage ledger (generative units consumed) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_budget_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  feature_id text,
  period text NOT NULL CHECK (period IN ('daily', 'monthly')),
  period_key text NOT NULL,
  units_used numeric NOT NULL DEFAULT 0 CHECK (units_used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_budget_usage_school_period
  ON public.ai_budget_usage (school_id, period, period_key);

-- Partial uniques (NULL feature_id = school-wide counter)
CREATE UNIQUE INDEX IF NOT EXISTS ai_budget_usage_school_day
  ON public.ai_budget_usage (school_id, period, period_key)
  WHERE feature_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_budget_usage_feature_day
  ON public.ai_budget_usage (school_id, feature_id, period, period_key)
  WHERE feature_id IS NOT NULL;

ALTER TABLE public.ai_budget_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_budget_usage read admin" ON public.ai_budget_usage;
CREATE POLICY "ai_budget_usage read admin" ON public.ai_budget_usage
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

GRANT SELECT ON public.ai_budget_usage TO authenticated;
GRANT ALL ON public.ai_budget_usage TO service_role;

-- ── Reserve / check budget (service_role / gateway) ───────────────────────────
CREATE OR REPLACE FUNCTION public.ai_budget_check_and_reserve(
  p_school_id uuid,
  p_feature_id text,
  p_units numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day text := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD');
  v_soft int := 200;
  v_hard int := 400;
  v_feature_soft int;
  v_school_used numeric := 0;
  v_feature_used numeric := 0;
  v_used numeric := 0;
BEGIN
  IF p_school_id IS NULL OR p_feature_id IS NULL OR coalesce(p_units, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_args');
  END IF;

  SELECT soft_limit_units, coalesce(hard_limit_units, soft_limit_units * 2)
    INTO v_soft, v_hard
  FROM public.ai_budget_quotas
  WHERE school_id = p_school_id AND scope = 'school' AND period = 'daily'
  LIMIT 1;

  IF NOT FOUND THEN
    v_soft := 200;
    v_hard := 400;
  END IF;

  SELECT soft_limit_units INTO v_feature_soft
  FROM public.ai_budget_quotas
  WHERE school_id = p_school_id AND scope = 'feature' AND period = 'daily' AND feature_id = p_feature_id
  LIMIT 1;

  IF FOUND AND v_feature_soft IS NOT NULL THEN
    v_soft := LEAST(v_soft, v_feature_soft);
  END IF;

  SELECT coalesce(units_used, 0) INTO v_school_used
  FROM public.ai_budget_usage
  WHERE school_id = p_school_id AND period = 'daily' AND period_key = v_day AND feature_id IS NULL;

  SELECT coalesce(units_used, 0) INTO v_feature_used
  FROM public.ai_budget_usage
  WHERE school_id = p_school_id AND period = 'daily' AND period_key = v_day AND feature_id = p_feature_id;

  v_used := GREATEST(coalesce(v_school_used, 0), coalesce(v_feature_used, 0));

  IF v_used + p_units > v_hard THEN
    RETURN jsonb_build_object(
      'ok', false,
      'soft_breach', true,
      'hard_breach', true,
      'error_code', 'budget_exhausted',
      'units_used', v_used,
      'soft_limit', v_soft,
      'hard_limit', v_hard
    );
  END IF;

  INSERT INTO public.ai_budget_usage (school_id, feature_id, period, period_key, units_used, updated_at)
  VALUES (p_school_id, NULL, 'daily', v_day, p_units, now())
  ON CONFLICT (school_id, period, period_key) WHERE feature_id IS NULL
  DO UPDATE SET units_used = public.ai_budget_usage.units_used + EXCLUDED.units_used,
                updated_at = now();

  INSERT INTO public.ai_budget_usage (school_id, feature_id, period, period_key, units_used, updated_at)
  VALUES (p_school_id, p_feature_id, 'daily', v_day, p_units, now())
  ON CONFLICT (school_id, feature_id, period, period_key) WHERE feature_id IS NOT NULL
  DO UPDATE SET units_used = public.ai_budget_usage.units_used + EXCLUDED.units_used,
                updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'soft_breach', (v_used + p_units) > v_soft,
    'units_used', v_used + p_units,
    'soft_limit', v_soft,
    'hard_limit', v_hard
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_budget_check_and_reserve(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_budget_check_and_reserve(uuid, text, numeric) TO service_role;

-- ── Analytics summary RPC (admin / principal) ─────────────────────────────────
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
