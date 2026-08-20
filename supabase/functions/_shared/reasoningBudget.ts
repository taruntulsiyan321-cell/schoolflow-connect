/**
 * Adaptive Reasoning Budget v1 — Simple / Medium / Complex tiers.
 * Caps tokens & latency posture for generative calls. Enterprise reserved for Phase 2 workflows.
 */

export type ReasoningTier = "simple" | "medium" | "complex" | "enterprise";

export type TierLimits = {
  tier: ReasoningTier;
  max_input_tokens: number;
  max_output_tokens: number;
  temperature: number;
  latency_posture: "interactive_tight" | "interactive" | "interactive_or_async" | "async";
};

/** Control-plane defaults (tunable later via flags / tables). */
export const TIER_LIMITS: Record<ReasoningTier, TierLimits> = {
  simple: {
    tier: "simple",
    max_input_tokens: 600,
    max_output_tokens: 250,
    temperature: 0.1,
    latency_posture: "interactive_tight",
  },
  medium: {
    tier: "medium",
    max_input_tokens: 1200,
    max_output_tokens: 500,
    temperature: 0.2,
    latency_posture: "interactive",
  },
  complex: {
    tier: "complex",
    max_input_tokens: 1800,
    max_output_tokens: 900,
    temperature: 0.25,
    latency_posture: "interactive_or_async",
  },
  enterprise: {
    tier: "enterprise",
    max_input_tokens: 4000,
    max_output_tokens: 2000,
    temperature: 0.3,
    latency_posture: "async",
  },
};

export type TierSignals = {
  feature_id: string;
  /** When AE/EIE already answer the numeric part, prefer Simple explanation. */
  facts_complete?: boolean;
  input_text_length?: number;
  /** School under budget pressure → prefer downgrade. */
  budget_pressure?: boolean;
  /** Explicit capability default override. */
  capability_default?: ReasoningTier;
};

const CAPABILITY_DEFAULTS: Record<string, ReasoningTier> = {
  "student.performance.explain": "simple",
  "student.concept.explain": "simple",
  // "medium" (500 output tokens), not "simple" (250) — nova.chat is open-ended tutoring, not a
  // fixed fact lookup; 250 tokens truncates a real worked example mid-solution (verified live:
  // a 2-step quadratic-equation answer needs ~900 tokens to finish; 500 covers the large
  // majority of classroom questions without jumping straight to "complex" tier cost).
  "student.nova.chat": "medium",
  "student.knowledge.retrieve": "simple",
  "student.recommendation.explain": "simple",
  "teacher.question_paper.plan": "simple",
  "teacher.question_paper.generate_outline": "medium",
  "teacher.question_paper.marking_scheme": "medium",
  "principal.school.health_brief": "simple",
  "student.image_doubt.submit": "simple",
  "student.image_doubt.solve": "medium",
  "student.voice_doubt.submit": "simple",
  "parent.child.narrative": "simple",
  "student.doubt.solve": "medium",
  "student.mistake.analysis": "complex",
};

/**
 * Assign tier. Downgrades when facts already suffice or budget pressure is high.
 * Never auto-promotes to Enterprise (Orchestrator-only in Phase 2).
 */
export function assignReasoningTier(signals: TierSignals): ReasoningTier {
  let tier: ReasoningTier =
    signals.capability_default ??
    CAPABILITY_DEFAULTS[signals.feature_id] ??
    "medium";

  if (tier === "enterprise") tier = "complex";

  // Nova chat is exempt: "facts complete" just means the student's academic records (attendance/
  // marks/etc.) are populated, which is true for almost every real student — it says nothing
  // about whether THIS message needs a short fact or a full worked answer, so forcing "simple"
  // here truncated real tutoring answers (a genuine bug, found by live-testing a math question).
  // The other capabilities below are single-purpose fact lookups where this override is correct.
  if (signals.facts_complete && signals.feature_id !== "student.nova.chat") {
    tier = "simple";
  }

  const len = signals.input_text_length ?? 0;
  if (len > 800 && tier === "simple") tier = "medium";
  if (len > 2000 && (tier === "simple" || tier === "medium")) tier = "complex";

  if (signals.budget_pressure) {
    if (tier === "complex" || tier === "enterprise") tier = "medium";
    else if (tier === "medium") tier = "simple";
  }

  return tier;
}

export function getTierLimits(tier: ReasoningTier): TierLimits {
  return TIER_LIMITS[tier];
}

/** Map tier → modelRouter invocation ceilings. */
export function modelCallOptionsForTier(tier: ReasoningTier): {
  max_tokens: number;
  temperature: number;
} {
  const limits = getTierLimits(tier);
  return {
    max_tokens: limits.max_output_tokens,
    temperature: limits.temperature,
  };
}
