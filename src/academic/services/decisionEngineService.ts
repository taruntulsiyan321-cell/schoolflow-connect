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
};
