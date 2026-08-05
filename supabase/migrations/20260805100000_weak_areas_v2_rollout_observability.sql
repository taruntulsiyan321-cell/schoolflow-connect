-- Weak Areas V2 rollout observability ("Step 0" -- prepare the pilot, do
-- NOT enable it). The flag (DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2 in
-- src/lib/productFeatureFlags.ts) is not touched by this migration at all.
--
-- Reads the practice.weak_areas.path_used / practice.weak_areas.v2_failed
-- events practiceService.ts already emits (via the existing emitEvent /
-- academic_events outbox, defined in
-- 20260730020000_academic_engine_foundation.sql) and returns eight numbers:
-- how often V1 vs V2 ran, how often V2 failed or came back empty, how many
-- recommendations it produced, and how many distinct students actually got
-- at least one. Pure read -- never writes to academic_events.status or
-- processes rows; these events have no downstream outbox consumer, and
-- that's fine here, this is not that kind of consumer.
--
-- Named and shaped for the whole Decision Engine, not just Weak Areas, on
-- purpose -- Revision V2, Recovery V2, and Nova will all want the same one
-- rollout view later, and this avoids a migration rename when they arrive:
-- the JSON nests today's numbers under a "weak_areas" key so future engines
-- can slot in as sibling keys without touching this shape. Also uses this
-- codebase's actual rpc_ naming convention -- ai_analytics_summary_v1 (the
-- structural precedent this borrows from: STABLE SECURITY DEFINER, role
-- check, PL/pgSQL aggregation into one jsonb_build_object) is itself an
-- outlier in lacking that prefix; not copied.
--
-- School scoping: derived from the caller's own identity via
-- public.get_my_school_id() (20260802570000_student_context_class_identity.sql
-- -- falls back to profiles.school_id for admin/principal, who have no
-- students/teachers row), never a client-supplied parameter. This is a
-- deliberate improvement over ai_analytics_summary_v1's own p_school_id
-- parameter, which that function accepts unchecked -- it only verifies the
-- caller holds *a* qualifying role anywhere, not that the school id passed
-- in is actually theirs, so any admin/principal could currently read any
-- other school's AI analytics by passing a different id. Not fixed here
-- (out of scope for this task), but not reproduced either.
CREATE OR REPLACE FUNCTION public.rpc_decision_engine_rollout_summary_v1(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_school_id uuid := public.get_my_school_id();
  v_from timestamptz := coalesce(p_from, now() - interval '7 days');
  v_to timestamptz := coalesce(p_to, now());
  v1_uses int := 0;
  v2_uses int := 0;
  v2_failures int := 0;
  v2_empty_results int := 0;
  v2_total_recommendations numeric := 0;
  v2_students_with_recommendations int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_principal_or_admin(v_uid) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'no school context';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE event_type = 'practice.weak_areas.path_used' AND payload->>'path' = 'v1'
    ),
    count(*) FILTER (
      WHERE event_type = 'practice.weak_areas.path_used' AND payload->>'path' = 'v2'
    ),
    count(*) FILTER (
      WHERE event_type = 'practice.weak_areas.v2_failed'
    ),
    count(*) FILTER (
      WHERE event_type = 'practice.weak_areas.path_used'
        AND payload->>'path' = 'v2'
        AND payload->>'count' = '0'
    ),
    -- payload->>'count' didn't exist before this rollout, so older test/
    -- pilot rows lack the key -- guarded out of the sum, not treated as 0.
    coalesce(sum((payload->>'count')::numeric) FILTER (
      WHERE event_type = 'practice.weak_areas.path_used'
        AND payload->>'path' = 'v2'
        AND payload->>'count' IS NOT NULL
    ), 0),
    count(DISTINCT student_id) FILTER (
      WHERE event_type = 'practice.weak_areas.path_used'
        AND payload->>'path' = 'v2'
        AND payload->>'count' IS NOT NULL
        AND (payload->>'count')::int >= 1
    )
  INTO v1_uses, v2_uses, v2_failures, v2_empty_results, v2_total_recommendations, v2_students_with_recommendations
  FROM public.academic_events
  WHERE school_id = v_school_id
    AND event_type IN ('practice.weak_areas.path_used', 'practice.weak_areas.v2_failed')
    AND created_at >= v_from
    AND created_at <= v_to;

  RETURN jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to),
    'weak_areas', jsonb_build_object(
      'v1_uses', v1_uses,
      'v2_uses', v2_uses,
      'v2_failures', v2_failures,
      'v2_empty_results', v2_empty_results,
      'v2_total_recommendations', v2_total_recommendations,
      'v2_students_with_recommendations', v2_students_with_recommendations,
      'v2_failure_rate',
        CASE WHEN (v2_uses + v2_failures) = 0 THEN NULL
             ELSE round((v2_failures::numeric / (v2_uses + v2_failures)) * 1000) / 10 END,
      'v2_empty_result_rate',
        CASE WHEN v2_uses = 0 THEN NULL
             ELSE round((v2_empty_results::numeric / v2_uses) * 1000) / 10 END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_decision_engine_rollout_summary_v1(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_decision_engine_rollout_summary_v1(timestamptz, timestamptz) TO authenticated;
