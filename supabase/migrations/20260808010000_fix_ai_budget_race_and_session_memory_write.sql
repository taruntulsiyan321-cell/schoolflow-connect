-- =============================================================================
-- Fix 1: ai_budget_check_and_reserve check-then-act race condition
--
-- Found during the AI-subsystem architecture audit. The function reads
-- ai_budget_usage.units_used (SELECT ... INTO), compares against the hard
-- cap, and only then INSERTs/UPDATEs the counter -- with no row lock between
-- the read and the write. Under READ COMMITTED (Postgres's default), two
-- concurrent invocations for the same school (e.g. a burst of simultaneous
-- Nova-chat requests) can both read the same stale v_used, both pass the
-- v_used + p_units > v_hard check, and both proceed -- transiently exceeding
-- the school's daily hard cap by up to (N-1) x p_units for N concurrent
-- in-flight requests. The ON CONFLICT upserts are atomic at the row level so
-- the stored ledger ends up numerically correct after the fact; the
-- admission *decision* is what's racy.
--
-- Fix: take a transaction-scoped advisory lock keyed on the school before
-- doing any read, so concurrent calls for the same school serialize through
-- this function. pg_advisory_xact_lock auto-releases at transaction end
-- (this function's implicit transaction, or the caller's if one is open) --
-- no explicit unlock needed, no deadlock risk since only one lock is ever
-- held per call. Every other statement in the function is unchanged.
--
-- Fix 2: ai_session_memory "own write" policy missing tenant scoping
--
-- Same class of bug as 20260808000000_close_ai_adjacent_tenant_leaks.sql,
-- on the companion write policy for that migration's sibling read policy.
-- "ai_session_memory own read" was tenant-scoped for admin in the 2026-08-02
-- hardening pass (20260802170000_ai_audit_security_hardening.sql:684-696),
-- but "ai_session_memory own write" (FOR ALL -- INSERT/UPDATE/DELETE) was
-- defined once in 20260802140000_ai_phase3_vector_session_paper.sql:624-633
-- and never revisited: any admin account, in any school, could read/modify/
-- delete another school's AI workflow session-memory rows (tutoring/
-- paper_gen/parent_guidance/principal_analytics context). The normal write
-- path is the SECURITY DEFINER RPCs (ai_session_memory_open/append/close),
-- which bypass RLS entirely as the function owner -- this policy only
-- matters for direct table access (e.g. via PostgREST), but it should match
-- its own read policy's tenant scoping rather than diverge from it. Role
-- scope (admin only, not principal) is preserved exactly as originally
-- written -- only the missing same_school() check is added.
-- =============================================================================

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

  -- Serialize concurrent reservations for this school so the read-then-write
  -- admission check below can no longer race (see header comment).
  PERFORM pg_advisory_xact_lock(hashtext('ai_budget:' || p_school_id::text));

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

-- ── ai_session_memory write-policy tenant fix ────────────────────────────────
DROP POLICY IF EXISTS "ai_session_memory own write" ON public.ai_session_memory;
CREATE POLICY "ai_session_memory own write" ON public.ai_session_memory
  FOR ALL TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND public.same_school(school_id)
    )
  )
  WITH CHECK (
    actor_user_id = auth.uid()
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND public.same_school(school_id)
    )
  );
