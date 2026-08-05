-- Gurukul Academic Signal/Decision Engine — Slice 2: Retention + Revision.
--
-- Scope, as agreed before starting (mirrors the Slice 1 discipline of one
-- narrow, end-to-end-verifiable slice at a time):
--   1. Add concept_mastery.half_life_estimate, updated incrementally.
--   2. Derive retention_estimate at read time (never stored).
--   3. One Learning Dimension: _dim_retention.
--   4. One Policy: rpc_revision_plan_v2.
--   5. Nothing else — no Recovery redesign, no Nova, no Evidence Graph.
--
-- This is the first Slice that adds persisted state (Slice 1 was 100%
-- read-only). The only write-path touched is _upsert_concept_mastery, the
-- single shared per-attempt function every attempt-recording RPC already
-- funnels through (rpc_record_question_attempt, template completion, battle
-- practice, etc. — confirmed via grep, it has exactly one definition, in
-- 20260613000000_concept_mastery_recovery.sql, never redefined since). This
-- migration extends it additively; every existing column and existing
-- caller's behavior is unchanged.
--
-- Per docs/GURUKUL_ACADEMIC_SIGNAL_ENGINE_SPEC.md §9.6 and
-- docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md §4/§6.3 (Retention
-- dimension, Revision policy).

-- ── 1. New columns on concept_mastery ────────────────────────────────────
--
-- half_life_estimate: per-(student, concept) memory half-life in days. Per
-- §9.6, updated via a "Duolingo-style Half-Life-Regression-inspired
-- heuristic: successful spaced recall multiplies the half-life up; a
-- forgetting event resets it down" — explicitly a heuristic, not a fitted
-- regression. The growth/decay factors below (×1.8 on success, ×0.3 floored
-- at 0.5 days on failure) sit inside the range real spaced-repetition
-- systems use for their ease factor (SM-2/Anki: ~1.3–2.5×), not arbitrary.
--
-- forgetting_events_count: §9.6's exact definition — "count of times a
-- concept previously at current_status = correct was later answered wrong."
-- Detecting that transition requires knowing the previous outcome, hence:
--
-- last_outcome_correct: whether the most recent attempt on this concept was
-- correct. Exists purely to make forgetting-event detection possible; not
-- itself one of the named Signals in the spec.
ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS half_life_estimate numeric NOT NULL DEFAULT 1.0
    CHECK (half_life_estimate > 0),
  ADD COLUMN IF NOT EXISTS forgetting_events_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_outcome_correct boolean;

COMMENT ON COLUMN public.concept_mastery.half_life_estimate IS
  'Days. Updated incrementally by _upsert_concept_mastery on every attempt after the first (a recall event). Never read directly by product code -- retention_estimate is derived from it at query time in _dim_retention, per Signal Engine spec Sec 9.6 (derived values are never stored, since they decay continuously even with zero new evidence).';
COMMENT ON COLUMN public.concept_mastery.forgetting_events_count IS
  'Count of correct-then-wrong transitions on this concept. Backfilled once below from question_attempts (exact, not approximated); maintained incrementally thereafter.';
COMMENT ON COLUMN public.concept_mastery.last_outcome_correct IS
  'Most recent attempt outcome for this concept. Internal bookkeeping for forgetting_events_count, not a product-facing signal.';

-- ── 2. Backfill for existing rows ────────────────────────────────────────
--
-- forgetting_events_count and last_outcome_correct are backfilled exactly,
-- from the real question_attempts history (available from
-- 20260804010000_practice_engine_question_record.sql onward -- concepts
-- whose entire history predates that table simply keep the defaults of 0 /
-- NULL, which is honest: there is no attempt-level history to derive from,
-- not a bug).
WITH ordered AS (
  SELECT
    user_id, subject, chapter, concept, subconcept, is_correct, created_at,
    LAG(is_correct) OVER (
      PARTITION BY user_id, subject, chapter, concept, subconcept
      ORDER BY created_at
    ) AS prev_correct
  FROM public.question_attempts
  WHERE NOT COALESCE(skipped, false)
),
forgetting AS (
  SELECT user_id, subject, chapter, concept, subconcept, COUNT(*) AS cnt
  FROM ordered
  WHERE prev_correct = true AND is_correct = false
  GROUP BY user_id, subject, chapter, concept, subconcept
)
UPDATE public.concept_mastery cm
SET forgetting_events_count = f.cnt
FROM forgetting f
WHERE cm.user_id = f.user_id
  AND cm.subject = f.subject
  AND COALESCE(cm.chapter, '') = COALESCE(f.chapter, '')
  AND cm.concept = f.concept
  AND COALESCE(cm.subconcept, '') = COALESCE(f.subconcept, '');

WITH latest AS (
  SELECT DISTINCT ON (user_id, subject, chapter, concept, subconcept)
    user_id, subject, chapter, concept, subconcept, is_correct
  FROM public.question_attempts
  WHERE NOT COALESCE(skipped, false)
  ORDER BY user_id, subject, chapter, concept, subconcept, created_at DESC
)
UPDATE public.concept_mastery cm
SET last_outcome_correct = l.is_correct
FROM latest l
WHERE cm.user_id = l.user_id
  AND cm.subject = l.subject
  AND COALESCE(cm.chapter, '') = COALESCE(l.chapter, '')
  AND cm.concept = l.concept
  AND COALESCE(cm.subconcept, '') = COALESCE(l.subconcept, '');

-- half_life_estimate backfill is necessarily an approximation, not a replay
-- -- reconstructing it exactly would mean replaying every historical attempt
-- through the incremental formula below in order, which is real
-- migration-time cost for a value the spec itself frames as forward-going
-- ("Update: on each attempt..."), not something the Signal Engine promises
-- to reconstruct perfectly from history. Approximation used: apply the same
-- ×1.8 growth factor the live update uses, once per correct_attempts
-- already on record (capped at 10 steps to avoid absurd extrapolation for
-- heavily-practiced concepts) -- consistent methodology with the ongoing
-- formula, not a second, diverging one. retention_estimate is derived at
-- read time, so as fresh attempts land post-migration this seed's influence
-- fades within a handful of real updates; it is not a permanent record.
UPDATE public.concept_mastery
SET half_life_estimate = LEAST(180, GREATEST(1.0, POWER(1.8, LEAST(correct_attempts, 10))))
WHERE total_attempts > 0;

-- ── 3. _upsert_concept_mastery — additive extension ──────────────────────
-- Identical to the live definition in 20260613000000_concept_mastery_recovery.sql
-- except for the half_life_estimate / forgetting_events_count /
-- last_outcome_correct handling, marked below. Every existing column,
-- parameter, and existing caller's behavior is unchanged.
CREATE OR REPLACE FUNCTION public._upsert_concept_mastery(
  _uid uuid, _sid uuid, _class int, _subject text, _chapter text, _concept text, _subconcept text,
  _is_correct boolean, _is_recovery boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _mistakes int;
BEGIN
  IF _concept IS NULL OR _concept = '' THEN
    _concept := COALESCE(_chapter, _subject, 'General');
  END IF;

  SELECT count(*)::int INTO _mistakes FROM public.student_mistakes
  WHERE user_id = _uid AND NOT mastered
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND COALESCE(concept, topic, '') = COALESCE(_concept, '');

  INSERT INTO public.concept_mastery (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    total_attempts, correct_attempts, recovery_attempts, recovery_correct,
    mistake_count, last_attempt_at, mastery_score, updated_at,
    half_life_estimate, forgetting_events_count, last_outcome_correct
  ) VALUES (
    _uid, _sid, _class, _subject, _chapter, _concept, _subconcept,
    1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    _mistakes, now(),
    public._compute_mastery_score(
      1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    now(),
    -- ▼ Slice 2: first-ever attempt on this concept is a first-learning
    -- event, not a recall -- seed a neutral baseline rather than applying
    -- the grow/reset heuristic, per Sec 9.6 ("on each attempt where the
    -- concept was previously known... not a first-learning event").
    1.0, 0, _is_correct
    -- ▲
  )
  ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
  DO UPDATE SET
    student_id = COALESCE(EXCLUDED.student_id, concept_mastery.student_id),
    class_level = COALESCE(EXCLUDED.class_level, concept_mastery.class_level),
    total_attempts = concept_mastery.total_attempts + 1,
    correct_attempts = concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
    recovery_attempts = concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    recovery_correct = concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    mistake_count = _mistakes,
    last_attempt_at = now(),
    mastery_score = public._compute_mastery_score(
      concept_mastery.total_attempts + 1,
      concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
      concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    updated_at = now(),
    -- ▼ Slice 2: every attempt after the first is a recall event. Success
    -- multiplies the half-life up (capped at 180 days); a forgetting event
    -- (wrong now, correct last time) resets it down (floored at 0.5 days)
    -- and increments forgetting_events_count. A wrong-after-wrong repeat is
    -- not a *new* forgetting event -- the concept was already known-not-
    -- retained, so only the correct->wrong transition counts, per Sec 9.6's
    -- exact definition.
    half_life_estimate = CASE
      WHEN _is_correct THEN LEAST(180, concept_mastery.half_life_estimate * 1.8)
      ELSE GREATEST(0.5, concept_mastery.half_life_estimate * 0.3)
    END,
    forgetting_events_count = concept_mastery.forgetting_events_count
      + CASE WHEN NOT _is_correct AND concept_mastery.last_outcome_correct IS TRUE THEN 1 ELSE 0 END,
    last_outcome_correct = _is_correct;
    -- ▲
END; $$;

-- ── 4. _dim_retention — the Retention Learning Dimension ─────────────────
-- "How much of what was learned is still accessible right now?" Built from
-- retention_estimate (derived from half_life_estimate), per Decision Engine
-- spec Sec 4. Computed fresh on every call -- retention decays with time
-- even with zero new evidence, so this can (correctly) change value on a
-- day the student did nothing. Returns 0-100 (probability × 100, matching
-- every other dimension's normalization rule). Returns NULL when there is
-- no evidence yet (no concept_mastery row) -- there is nothing to forget
-- yet, which is a different state from "retention is low."
CREATE OR REPLACE FUNCTION public._dim_retention(
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
  _half_life numeric;
  _last_attempt timestamptz;
  _days numeric;
BEGIN
  SELECT half_life_estimate, last_attempt_at INTO _half_life, _last_attempt
  FROM public.concept_mastery
  WHERE user_id = _user_id
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept
    AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  LIMIT 1;

  IF _half_life IS NULL OR _half_life <= 0 OR _last_attempt IS NULL THEN
    RETURN NULL;
  END IF;

  _days := GREATEST(0, EXTRACT(EPOCH FROM (now() - _last_attempt)) / 86400.0);
  RETURN ROUND(POWER(2, -_days / _half_life) * 100, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public._dim_retention(uuid, text, text, text, text) TO authenticated;

-- ── 5. rpc_revision_plan_v2 — the Revision Policy ────────────────────────
-- Objective (Decision Engine spec Sec 6.3): identify concepts the student
-- *understands* but is at risk of forgetting -- the mirror image of Weak
-- Areas by construction (Weak Areas requires understanding < 65; Revision
-- requires understanding >= 65, so a concept can never qualify for both).
--
-- Registered thresholds for this policy (documented here; a formal,
-- queryable Policy Registry remains out of scope, same as Slice 1):
--   qualifies when evidence_strength >= 30   (sufficient evidence)
--         AND  understanding >= 65           (adequate-to-good, the gate
--                                              that separates this from
--                                              Weak Areas)
--         AND  retention < 70                (meaningfully decayed --
--                                              "at risk of forgetting")
--   priority = 0.75*(100-retention) + 0.25*evidence_strength
--   Deliberately excludes understanding from the priority formula: per
--   spec, "priority driven by forgetting probability/urgency, not by how
--   well the concept was ever understood." Understanding is a gate here,
--   not a priority input.
--   limit 20, ordered by priority DESC
CREATE OR REPLACE FUNCTION public.rpc_revision_plan_v2()
RETURNS TABLE (
  subject text,
  chapter text,
  concept text,
  subconcept text,
  understanding numeric,
  evidence_strength numeric,
  retention numeric,
  forgetting_events_count int,
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
    SELECT cm.subject, cm.chapter, cm.concept, cm.subconcept, cm.forgetting_events_count
    FROM public.concept_mastery cm
    WHERE cm.user_id = _uid AND cm.total_attempts > 0
  ),
  scored AS (
    SELECT
      c.subject, c.chapter, c.concept, c.subconcept, c.forgetting_events_count,
      public._dim_understanding(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS understanding,
      public._dim_evidence_strength(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS evidence_strength,
      public._dim_retention(_uid, c.subject, c.chapter, c.concept, c.subconcept) AS retention
    FROM candidates c
  ),
  qualified AS (
    SELECT
      s.*,
      ROUND(
        (100 - COALESCE(s.retention, 0)) * 0.75
        + COALESCE(s.evidence_strength, 0) * 0.25,
        1
      ) AS priority
    FROM scored s
    WHERE COALESCE(s.evidence_strength, 0) >= 30
      AND COALESCE(s.understanding, 0) >= 65
      AND COALESCE(s.retention, 0) < 70
  )
  SELECT
    q.subject, q.chapter, q.concept, q.subconcept,
    q.understanding, q.evidence_strength, q.retention, q.forgetting_events_count,
    q.priority,
    jsonb_build_object(
      'understanding', q.understanding,
      'evidence_strength', q.evidence_strength,
      'retention', q.retention,
      'forgetting_events_count', q.forgetting_events_count
    ) AS reason
  FROM qualified q
  ORDER BY q.priority DESC
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_revision_plan_v2() TO authenticated;
