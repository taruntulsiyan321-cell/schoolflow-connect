-- Gurukul Academic Signal/Decision Engine — Slice 1: Weak Areas, done right.
--
-- Implements exactly the narrow slice approved in the plan
-- (C:\Users\ash\.claude\plans\mutable-singing-jellyfish.md): four read-only
-- Learning Dimension functions computed over EXISTING tables (concept_mastery,
-- question_attempts) with zero new columns or tables, plus one Policy
-- (rpc_weak_areas_v2) that reads those dimensions and returns structured
-- Recommendation rows -- never a bare ranked list.
--
-- Per docs/GURUKUL_ACADEMIC_SIGNAL_ENGINE_SPEC.md and
-- docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md:
--   - Dimensions read Signals only, are computed at read time, never stored.
--   - The Policy reads Dimensions only, never invents a new fact, and
--     produces Recommendation-shaped output (target + structured reason +
--     priority), per the Decision Engine document's explicit rule (§7).
--
-- This migration is 100% additive and read-only: no INSERT/UPDATE/DELETE
-- anywhere below, and it does not modify rpc_record_question_attempt,
-- rpc_finish_practice_session, or any existing Recovery/Revision function.
-- Existing behavior (including the currently-duplicated, currently-
-- inconsistent weak-concept thresholds in _weak_topics_for_user,
-- rpc_academic_revision_plan, _concept_severity, severityFromWrong(), and
-- buildRuleAnalyticsInsights()) is untouched. This is a new, independently
-- verifiable system living alongside them -- not a replacement. Migrating
-- any existing consumer to this layer is explicitly out of scope here.

-- ── 1. _dim_evidence_strength ────────────────────────────────────────────
-- "How much can the other three dimensions below actually be trusted?"
-- Wilson score interval (95%, z=1.96) over concept_mastery's own
-- total_attempts/correct_attempts -- exactly the worked example in the
-- Signal Engine document §7: 1 attempt at 100% must score far below
-- 50 attempts at 100%. Returns 0-100; 0 attempts returns 0 (no evidence).
CREATE OR REPLACE FUNCTION public._dim_evidence_strength(
  _user_id uuid,
  _subject text,
  _chapter text,
  _concept text,
  _subconcept text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n numeric;
  _correct numeric;
  _p numeric;
  _z numeric := 1.96;
  _denom numeric;
  _center numeric;
  _margin numeric;
  _width numeric;
BEGIN
  SELECT total_attempts, correct_attempts INTO _n, _correct
  FROM public.concept_mastery
  WHERE user_id = _user_id
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept
    AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  LIMIT 1;

  IF _n IS NULL OR _n <= 0 THEN
    RETURN 0;
  END IF;

  _p := _correct / _n;
  _denom := 1 + (_z * _z) / _n;
  _center := (_p + (_z * _z) / (2 * _n)) / _denom;
  _margin := (_z * sqrt(_p * (1 - _p) / _n + (_z * _z) / (4 * _n * _n))) / _denom;
  _width := LEAST(1.0, 2 * _margin);

  RETURN ROUND((1 - _width) * 100, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public._dim_evidence_strength(uuid, text, text, text, text) TO authenticated;

-- ── 2. _dim_understanding ────────────────────────────────────────────────
-- "Does the student grasp this concept?" Reads the existing
-- concept_mastery.confidence_score (the V1 Practice Engine's simple
-- correct/attempted ratio, already 0-100). Falls back to computing the same
-- ratio directly from correct_attempts/total_attempts when confidence_score
-- hasn't been populated yet (e.g. no practice session has been *finished*
-- for this concept, only individual attempts recorded) -- confidence_score
-- is only written at session-finish, per
-- _recompute_concept_confidence_for_session, so this fallback is a normal,
-- expected case, not an error condition.
CREATE OR REPLACE FUNCTION public._dim_understanding(
  _user_id uuid,
  _subject text,
  _chapter text,
  _concept text,
  _subconcept text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    confidence_score,
    ROUND(100.0 * correct_attempts / NULLIF(total_attempts, 0), 1)
  )
  FROM public.concept_mastery
  WHERE user_id = _user_id
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept
    AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public._dim_understanding(uuid, text, text, text, text) TO authenticated;

-- ── 3. _dim_consistency ──────────────────────────────────────────────────
-- "Is performance stable, or oscillating?" Computed directly from the
-- append-only question_attempts log -- no new ring-buffer column needed for
-- this slice. Looks at the last 10 non-skipped attempts on this concept;
-- counts sign-changes (correct->wrong or wrong->correct) between
-- consecutive attempts. High sign-change rate = low consistency (the
-- C-W-C-W-C-W case from both design documents); few changes = high
-- consistency (C-C-C-C-C-W), regardless of whether the stable streak is
-- good or bad -- direction is Understanding's job, not this dimension's.
-- Returns NULL (not 0) when fewer than 2 attempts exist -- there is no
-- meaningful consistency signal from a single data point, and NULL lets
-- the policy layer distinguish "unknown" from "actually volatile."
CREATE OR REPLACE FUNCTION public._dim_consistency(
  _user_id uuid,
  _subject text,
  _chapter text,
  _concept text,
  _subconcept text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result numeric;
BEGIN
  WITH recent AS (
    SELECT is_correct,
      ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
    FROM public.question_attempts
    WHERE user_id = _user_id
      AND subject = _subject
      AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept
      AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
      AND NOT COALESCE(skipped, false)
    ORDER BY created_at DESC
    LIMIT 10
  ),
  pairs AS (
    SELECT
      COUNT(*) AS n_pairs,
      COUNT(*) FILTER (WHERE a.is_correct IS DISTINCT FROM b.is_correct) AS n_changes
    FROM recent a
    JOIN recent b ON b.rn = a.rn + 1
  )
  SELECT CASE WHEN n_pairs < 1 THEN NULL
              ELSE ROUND((1 - (n_changes::numeric / n_pairs)) * 100, 1)
         END
  INTO _result
  FROM pairs;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public._dim_consistency(uuid, text, text, text, text) TO authenticated;

-- ── 4. _dim_growth_trend ─────────────────────────────────────────────────
-- "Is this concept improving or declining, right now?" Signed delta:
-- accuracy over the last 5 non-skipped attempts, minus the concept's
-- all-time accuracy from concept_mastery. Positive = recent performance
-- above the long-run baseline (improving); negative = below it (declining).
-- This is a deliberately simple Slice-1 approximation of the EWMA-delta
-- pattern in the Signal Engine document (§9.8 of that document) -- a full
-- exponentially-weighted implementation is left for a later slice.
-- Returns NULL when there isn't enough history to compare against.
CREATE OR REPLACE FUNCTION public._dim_growth_trend(
  _user_id uuid,
  _subject text,
  _chapter text,
  _concept text,
  _subconcept text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recent_n int;
  _recent_correct int;
  _overall_n numeric;
  _overall_correct numeric;
  _result numeric;
BEGIN
  SELECT total_attempts, correct_attempts INTO _overall_n, _overall_correct
  FROM public.concept_mastery
  WHERE user_id = _user_id
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept
    AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  LIMIT 1;

  IF _overall_n IS NULL OR _overall_n <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct)
  INTO _recent_n, _recent_correct
  FROM (
    SELECT is_correct
    FROM public.question_attempts
    WHERE user_id = _user_id
      AND subject = _subject
      AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept
      AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
      AND NOT COALESCE(skipped, false)
    ORDER BY created_at DESC
    LIMIT 5
  ) recent;

  IF _recent_n IS NULL OR _recent_n = 0 THEN
    RETURN NULL;
  END IF;

  _result := ROUND(
    (100.0 * _recent_correct / _recent_n) - (100.0 * _overall_correct / _overall_n),
    1
  );
  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public._dim_growth_trend(uuid, text, text, text, text) TO authenticated;

-- ── 5. rpc_weak_areas_v2 — the first real Policy ─────────────────────────
-- Reads only the four Dimensions above (never a raw Signal or table
-- directly, keeping this a genuine Policy rather than another inline
-- threshold check). Produces Recommendation-shaped rows: target (the
-- concept), a structured `reason` (the exact dimension values that
-- justified it, per the Decision Engine document §7 -- not prose), and a
-- `priority`. No UI concerns, no display logic, no ordering beyond
-- priority DESC.
--
-- Registered thresholds for this policy (documented here; a formal,
-- queryable Policy Registry is out of scope for this slice per the plan):
--   qualifies when evidence_strength >= 30  (enough evidence to trust)
--         AND  understanding < 65           (meaningfully below solid)
--   priority = 0.40*(100-understanding) + 0.25*(100-consistency)
--            + 0.15*max(0, -growth_trend) + 0.20*evidence_strength
--   limit 20, ordered by priority DESC
CREATE OR REPLACE FUNCTION public.rpc_weak_areas_v2()
RETURNS TABLE (
  subject text,
  chapter text,
  concept text,
  subconcept text,
  understanding numeric,
  evidence_strength numeric,
  consistency numeric,
  growth_trend numeric,
  priority numeric,
  reason jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT cm.subject, cm.chapter, cm.concept, cm.subconcept
    FROM public.concept_mastery cm
    WHERE cm.user_id = _uid AND cm.total_attempts > 0
  ),
  scored AS (
    SELECT
      c.subject, c.chapter, c.concept, c.subconcept,
      public._dim_understanding(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS understanding,
      public._dim_evidence_strength(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS evidence_strength,
      public._dim_consistency(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS consistency,
      public._dim_growth_trend(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS growth_trend
    FROM candidates c
  ),
  qualified AS (
    SELECT
      s.*,
      ROUND(
        (100 - COALESCE(s.understanding, 50)) * 0.40
        + (100 - COALESCE(s.consistency, 50)) * 0.25
        + GREATEST(0, -COALESCE(s.growth_trend, 0)) * 0.15
        + COALESCE(s.evidence_strength, 0) * 0.20,
        1
      ) AS priority
    FROM scored s
    WHERE COALESCE(s.evidence_strength, 0) >= 30
      AND COALESCE(s.understanding, 100) < 65
  )
  SELECT
    q.subject, q.chapter, q.concept, q.subconcept,
    q.understanding, q.evidence_strength, q.consistency, q.growth_trend,
    q.priority,
    jsonb_build_object(
      'understanding', q.understanding,
      'evidence_strength', q.evidence_strength,
      'consistency', q.consistency,
      'growth_trend', q.growth_trend
    ) AS reason
  FROM qualified q
  ORDER BY q.priority DESC
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_weak_areas_v2() TO authenticated;
