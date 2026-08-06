-- Gurukul Academic Signal/Decision Engine — Slice 3: Recovery.
--
-- Scope, held to the same discipline as Slices 1 and 2: one new Learning
-- Dimension (Recovery Need), one new Policy (Recovery). No product UI, no
-- consumer wiring, no feature flag — that's separate, later integration
-- work, exactly like Weak Areas (Slice 1) and Revision (Slice 2) each got
-- their own dedicated integration task after the slice itself existed and
-- was independently verified.
--
-- Per docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md §4 (Recovery Need) and
-- §6.3 (Recovery policy):
--   "Recovery Need: How urgently does this concept require remediation?
--    Built From: current_status, repeated_recovery_count,
--    forgetting_events_count, inverse of mastery_probability."
--   "Recovery: Reads Recovery Need (high), Consistency (specifically,
--    stability of being wrong — repeated failure, not a one-off), Evidence
--    Strength (high — recovery should not fire on thin evidence), Growth
--    Trend (flat or negative). Differs from Weak Areas by requiring
--    repeated, stable failure rather than merely low retention."
--
-- This migration is 100% additive and read-only: no INSERT/UPDATE/DELETE
-- anywhere below. rpc_assign_concept_recovery, rpc_student_recovery_zone,
-- Recovery.tsx, and RecoveryZone.tsx/useRecoveryZone are all untouched —
-- this is a new, independently verifiable system living alongside them.

-- ── 1. _dim_recovery_need ─────────────────────────────────────────────────
-- Reads concept_mastery only -- immutable-ish learning evidence
-- (understanding, forgetting history, most recent outcome), never
-- recovery_assignments (product workflow state: who got assigned recovery,
-- when, by what process). Mixing workflow into a Dimension would make its
-- value drift when the *workflow* changes -- a teacher deletes
-- assignments, Recovery gets redesigned -- even though the student's
-- actual learning didn't, breaking the Evidence -> Signals -> Dimensions
-- -> Policies separation this architecture is built on. If a future
-- Recovery policy revision wants to avoid reassigning the same concept
-- repeatedly, that's a Policy-level read of recovery_assignments as
-- tracked raw-signal debt, not part of this Dimension -- keeps it reusable
-- regardless of how the recovery workflow evolves.
--
-- Dominant term (50%) is inverse mastery, matching Weak Areas' own
-- weighting precedent; the other two terms are individually capped so
-- neither can dominate the score on its own:
--   recovery_need = (100 - understanding) * 0.5
--                  + (30 if the most recent attempt was wrong, else 0)
--                  + min(forgetting_events_count * 15, 20)
-- Bounds cleanly to [0, 100] by construction (50 + 30 + 20 = 100).
-- Returns NULL (not 0) when there's no concept_mastery row -- no evidence,
-- not "no need," same convention Slice 1 established.
CREATE OR REPLACE FUNCTION public._dim_recovery_need(
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
  _understanding numeric;
  _last_correct boolean;
  _forgetting_count int;
BEGIN
  -- Reuse _dim_understanding rather than re-deriving from confidence_score
  -- directly -- it already has the right fallback (confidence_score, else
  -- correct_attempts/total_attempts when confidence_score isn't populated
  -- yet). Re-deriving here would silently diverge from that.
  _understanding := public._dim_understanding(_user_id, _subject, _chapter, _concept, _subconcept);
  IF _understanding IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT last_outcome_correct, forgetting_events_count
  INTO _last_correct, _forgetting_count
  FROM public.concept_mastery
  WHERE user_id = _user_id
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept
    AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  LIMIT 1;

  RETURN LEAST(100, ROUND(
    (100 - _understanding) * 0.5
    + (CASE WHEN _last_correct IS FALSE THEN 30 ELSE 0 END)
    + LEAST(COALESCE(_forgetting_count, 0) * 15, 20)
  , 1));
END;
$$;

GRANT EXECUTE ON FUNCTION public._dim_recovery_need(uuid, text, text, text, text) TO authenticated;

-- ── 2. rpc_recovery_v2 — the Recovery Policy ─────────────────────────────
-- Reads four Dimensions only (three reused unchanged from Slice 1, one new
-- from this migration) -- never a raw Signal or table directly, per the
-- Decision Engine document's Policy Pattern rule.
--
-- _dim_consistency alone can't distinguish "stably right" from "stably
-- wrong" -- by its own design (a high sign-change count means low
-- consistency regardless of whether the stable streak is correct or
-- wrong; "direction is Understanding's job, not this dimension's" per its
-- own Slice 1 comment). This policy combines high consistency (stable)
-- with low understanding (the stable pattern is a bad one) to read
-- "stability of being wrong" -- exactly the kind of multi-dimension
-- combination Policies exist to do; no new Dimension needed for it.
--
-- Registered thresholds for this policy (documented here; a formal,
-- queryable Policy Registry remains out of scope, same as Slices 1-2):
--   qualifies when evidence_strength >= 50   (high bar -- recovery must
--                                              not fire on thin evidence)
--         AND  recovery_need >= 60           (meaningfully high need)
--         AND  consistency >= 50             (stable pattern, not a
--                                              one-off wrong answer)
--         AND  understanding < 65            (the stable pattern is BAD --
--                                              stably wrong, not stably
--                                              right)
--         AND  growth_trend <= 0             (flat or negative, per the
--                                              spec's exact wording)
--   priority = 0.7*recovery_need + 0.3*evidence_strength
--   limit 20, ordered by priority DESC
CREATE OR REPLACE FUNCTION public.rpc_recovery_v2()
RETURNS TABLE (
  subject text,
  chapter text,
  concept text,
  subconcept text,
  recovery_need numeric,
  consistency numeric,
  evidence_strength numeric,
  growth_trend numeric,
  understanding numeric,
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
      public._dim_recovery_need(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS recovery_need,
      public._dim_consistency(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS consistency,
      public._dim_evidence_strength(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS evidence_strength,
      public._dim_growth_trend(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS growth_trend,
      public._dim_understanding(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS understanding
    FROM candidates c
  ),
  qualified AS (
    SELECT
      s.*,
      ROUND(COALESCE(s.recovery_need, 0) * 0.7 + COALESCE(s.evidence_strength, 0) * 0.3, 1) AS priority
    FROM scored s
    WHERE COALESCE(s.evidence_strength, 0) >= 50
      AND COALESCE(s.recovery_need, 0) >= 60
      AND COALESCE(s.consistency, 0) >= 50
      AND COALESCE(s.understanding, 100) < 65
      AND COALESCE(s.growth_trend, 0) <= 0
  )
  SELECT
    q.subject, q.chapter, q.concept, q.subconcept,
    q.recovery_need, q.consistency, q.evidence_strength, q.growth_trend, q.understanding,
    q.priority,
    jsonb_build_object(
      'recovery_need', q.recovery_need,
      'consistency', q.consistency,
      'evidence_strength', q.evidence_strength,
      'growth_trend', q.growth_trend,
      'understanding', q.understanding
    ) AS reason
  FROM qualified q
  ORDER BY q.priority DESC
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_recovery_v2() TO authenticated;
