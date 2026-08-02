/**
 * Confidence Engine v1 — score responses; low confidence → safer / facts-only.
 * Does not rewrite AE/EIE facts.
 */

import type { ValidationResult } from "./responseValidator";
import type { ReasoningTier } from "./reasoningBudget";

export type ConfidenceFactors = {
  evidence_sufficiency: number;
  source_freshness: number;
  validator_pass_strength: number;
  numerical_consistency: number;
  schema_completeness: number;
  route_trust: number;
  uncertainty_disclosed: boolean;
  validator_codes: string[];
  budget_tier?: ReasoningTier;
  repair_attempted: boolean;
};

export type LowConfidenceAction =
  | "none"
  | "uncertainty_disclosure"
  | "safer_narrower_answer"
  | "facts_only"
  | "clarification";

export type ConfidenceResult = {
  confidence: number;
  factors: ConfidenceFactors;
  action: LowConfidenceAction;
  /** User-safe suffix when disclosing uncertainty. */
  disclosure?: string;
};

export type ScoreConfidenceInput = {
  used_model: boolean;
  cache_hit?: boolean;
  completeness: number;
  source_as_of?: string | null;
  validation?: ValidationResult | null;
  route_class?: string;
  budget_tier?: ReasoningTier;
  repair_attempted?: boolean;
  /** Hours since source_as_of; if unknown, omit. */
  freshness_hours?: number | null;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function freshnessScore(hours: number | null | undefined, sourceAsOf?: string | null): number {
  if (hours == null && sourceAsOf) {
    const t = Date.parse(sourceAsOf);
    if (Number.isFinite(t)) {
      hours = (Date.now() - t) / 3_600_000;
    }
  }
  if (hours == null || !Number.isFinite(hours)) return 0.7;
  if (hours <= 24) return 1;
  if (hours <= 72) return 0.85;
  if (hours <= 168) return 0.65;
  return 0.4;
}

/**
 * Weighted confidence ∈ [0,1]. Deterministic AE/EIE paths score high when fresh.
 */
export function scoreConfidence(input: ScoreConfidenceInput): ConfidenceResult {
  const completeness = clamp01(input.completeness);
  const freshness = freshnessScore(input.freshness_hours, input.source_as_of);
  const validation = input.validation;

  let validator_pass_strength = 1;
  let numerical_consistency = 1;
  if (input.used_model) {
    if (!validation) {
      validator_pass_strength = 0.4;
      numerical_consistency = 0.4;
    } else if (validation.material_failure) {
      validator_pass_strength = 0.1;
      numerical_consistency = 0.05;
    } else if (validation.codes.includes("too_long")) {
      validator_pass_strength = 0.7;
    } else {
      validator_pass_strength = validation.ok ? 1 : 0.5;
      numerical_consistency =
        validation.grounded_numbers_checked > 0 && validation.ok
          ? 1
          : validation.ok
            ? 0.85
            : 0.4;
    }
  }

  let route_trust = 0.75;
  if (!input.used_model) {
    if (input.route_class === "eie_insight") route_trust = 0.95;
    else if (input.route_class === "deterministic_record") route_trust = 0.98;
    else if (input.route_class === "deterministic_insight") route_trust = 0.92;
    else route_trust = 0.9;
  } else {
    route_trust = 0.65;
  }
  if (input.cache_hit) route_trust = Math.min(1, route_trust + 0.02);

  const factors: ConfidenceFactors = {
    evidence_sufficiency: completeness,
    source_freshness: freshness,
    validator_pass_strength,
    numerical_consistency,
    schema_completeness: completeness,
    route_trust,
    uncertainty_disclosed: false,
    validator_codes: validation?.codes ?? [],
    budget_tier: input.budget_tier,
    repair_attempted: !!input.repair_attempted,
  };

  const confidence = clamp01(
    factors.evidence_sufficiency * 0.2 +
      factors.source_freshness * 0.1 +
      factors.validator_pass_strength * 0.25 +
      factors.numerical_consistency * 0.25 +
      factors.schema_completeness * 0.05 +
      factors.route_trust * 0.15,
  );

  let action: LowConfidenceAction = "none";
  let disclosure: string | undefined;

  if (input.used_model && validation?.material_failure) {
    action = "facts_only";
  } else if (confidence < 0.45) {
    action = input.used_model ? "facts_only" : "clarification";
  } else if (confidence < 0.65) {
    action = "safer_narrower_answer";
    disclosure = input.source_as_of
      ? `Based on available school records as of ${input.source_as_of}.`
      : "Based on available school records; some metrics may be incomplete.";
    factors.uncertainty_disclosed = true;
  } else if (confidence < 0.8 && input.used_model) {
    action = "uncertainty_disclosure";
    disclosure = input.source_as_of
      ? `Based on available data as of ${input.source_as_of}.`
      : "Based on available school data.";
    factors.uncertainty_disclosed = true;
  }

  return { confidence: Math.round(confidence * 1000) / 1000, factors, action, disclosure };
}

/** Apply low-confidence policy to a generative payload. */
export function applyConfidencePolicy<T extends { explanation?: string | null; facts?: unknown }>(
  payload: T,
  result: ConfidenceResult,
): T & { confidence: number; confidence_action: LowConfidenceAction } {
  if (result.action === "facts_only") {
    return {
      ...payload,
      explanation: null,
      confidence: result.confidence,
      confidence_action: result.action,
      degraded_reason: "low_confidence_or_validation",
    } as T & { confidence: number; confidence_action: LowConfidenceAction };
  }

  let explanation = payload.explanation ?? null;
  if (explanation && result.disclosure) {
    explanation = `${explanation.trim()} ${result.disclosure}`;
  }

  return {
    ...payload,
    explanation,
    confidence: result.confidence,
    confidence_action: result.action,
  };
}
