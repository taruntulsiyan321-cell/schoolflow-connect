import { assertCanConsume, toRepoContext, type ServiceContext } from "./context";
import { getClient, throwIfError } from "../repository/base";

/**
 * A single Learning Dimension reading, per
 * docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md §4 — always paired with the
 * evidence behind it, never trusted alone.
 */
export interface WeakAreaRecommendation {
  subject: string;
  chapter: string | null;
  concept: string;
  subconcept: string | null;
  understanding: number | null;
  evidenceStrength: number | null;
  consistency: number | null;
  growthTrend: number | null;
  priority: number;
  /** Structured, not prose — the exact dimension values that justified this
   * recommendation, per the Decision Engine document §7. */
  reason: {
    understanding: number | null;
    evidence_strength: number | null;
    consistency: number | null;
    growth_trend: number | null;
  };
}

/**
 * A single Learning Dimension reading for the Revision policy, per
 * docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md §4/§6.3.
 */
export interface RevisionRecommendation {
  subject: string;
  chapter: string | null;
  concept: string;
  subconcept: string | null;
  understanding: number | null;
  evidenceStrength: number | null;
  retention: number | null;
  forgettingEventsCount: number;
  priority: number;
  /** Structured, not prose — the exact dimension values that justified this
   * recommendation, per the Decision Engine document §7. */
  reason: {
    understanding: number | null;
    evidence_strength: number | null;
    retention: number | null;
    forgetting_events_count: number;
  };
}

/**
 * A single Learning Dimension reading for the Recovery policy, per
 * docs/GURUKUL_ACADEMIC_DECISION_ENGINE_SPEC.md §4/§6.3.
 */
export interface RecoveryRecommendation {
  subject: string;
  chapter: string | null;
  concept: string;
  subconcept: string | null;
  recoveryNeed: number | null;
  consistency: number | null;
  evidenceStrength: number | null;
  growthTrend: number | null;
  understanding: number | null;
  priority: number;
  /** Structured, not prose — the exact dimension values that justified this
   * recommendation, per the Decision Engine document §7. */
  reason: {
    recovery_need: number | null;
    consistency: number | null;
    evidence_strength: number | null;
    growth_trend: number | null;
    understanding: number | null;
  };
}

/**
 * Decision Engine — Slice 1 ("Weak Areas, done right").
 *
 * This service reads only from rpc_weak_areas_v2, a read-only Policy that
 * itself reads only Learning Dimensions computed from existing Signals
 * (concept_mastery, question_attempts). It does not compute, threshold, or
 * interpret anything client-side — that would recreate exactly the kind of
 * duplicated, drifting logic this whole layer exists to replace.
 *
 * Deliberately not yet wired into any product surface (see the approved
 * plan) — verified via a dedicated Playwright diagnostic against the QA
 * automation account instead, before any existing Weak Areas / Recovery /
 * Revision UI is migrated to depend on it.
 */
export const DecisionEngineService = {
  async getWeakAreasV2(ctx: ServiceContext): Promise<WeakAreaRecommendation[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_weak_areas_v2");
    throwIfError(error, "Failed to load weak areas");

    type Row = {
      subject: string;
      chapter: string | null;
      concept: string;
      subconcept: string | null;
      understanding: number | null;
      evidence_strength: number | null;
      consistency: number | null;
      growth_trend: number | null;
      priority: number;
      reason: {
        understanding: number | null;
        evidence_strength: number | null;
        consistency: number | null;
        growth_trend: number | null;
      };
    };

    return ((data ?? []) as Row[]).map((row) => ({
      subject: row.subject,
      chapter: row.chapter,
      concept: row.concept,
      subconcept: row.subconcept,
      understanding: row.understanding,
      evidenceStrength: row.evidence_strength,
      consistency: row.consistency,
      growthTrend: row.growth_trend,
      priority: row.priority,
      reason: row.reason,
    }));
  },

  /**
   * Decision Engine — Slice 2 ("Retention + Revision"). Same discipline as
   * getWeakAreasV2: reads only rpc_revision_plan_v2, a read-only Policy
   * reading only Learning Dimensions (Understanding, Evidence Strength, the
   * new Retention dimension). No client-side thresholds or interpretation.
   */
  async getRevisionPlanV2(ctx: ServiceContext): Promise<RevisionRecommendation[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_revision_plan_v2");
    throwIfError(error, "Failed to load revision plan");

    type Row = {
      subject: string;
      chapter: string | null;
      concept: string;
      subconcept: string | null;
      understanding: number | null;
      evidence_strength: number | null;
      retention: number | null;
      forgetting_events_count: number;
      priority: number;
      reason: {
        understanding: number | null;
        evidence_strength: number | null;
        retention: number | null;
        forgetting_events_count: number;
      };
    };

    return ((data ?? []) as Row[]).map((row) => ({
      subject: row.subject,
      chapter: row.chapter,
      concept: row.concept,
      subconcept: row.subconcept,
      understanding: row.understanding,
      evidenceStrength: row.evidence_strength,
      retention: row.retention,
      forgettingEventsCount: row.forgetting_events_count,
      priority: row.priority,
      reason: row.reason,
    }));
  },

  /**
   * Decision Engine — Slice 3 ("Recovery"). Same discipline as
   * getWeakAreasV2/getRevisionPlanV2: reads only rpc_recovery_v2, a
   * read-only Policy reading only Learning Dimensions (Recovery Need,
   * Consistency, Evidence Strength, Growth Trend, Understanding). No
   * client-side thresholds or interpretation.
   */
  async getRecoveryV2(ctx: ServiceContext): Promise<RecoveryRecommendation[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_recovery_v2");
    throwIfError(error, "Failed to load recovery plan");

    type Row = {
      subject: string;
      chapter: string | null;
      concept: string;
      subconcept: string | null;
      recovery_need: number | null;
      consistency: number | null;
      evidence_strength: number | null;
      growth_trend: number | null;
      understanding: number | null;
      priority: number;
      reason: {
        recovery_need: number | null;
        consistency: number | null;
        evidence_strength: number | null;
        growth_trend: number | null;
        understanding: number | null;
      };
    };

    return ((data ?? []) as Row[]).map((row) => ({
      subject: row.subject,
      chapter: row.chapter,
      concept: row.concept,
      subconcept: row.subconcept,
      recoveryNeed: row.recovery_need,
      consistency: row.consistency,
      evidenceStrength: row.evidence_strength,
      growthTrend: row.growth_trend,
      understanding: row.understanding,
      priority: row.priority,
      reason: row.reason,
    }));
  },
};
