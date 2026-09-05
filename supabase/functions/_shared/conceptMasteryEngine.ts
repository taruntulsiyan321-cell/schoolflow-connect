/**
 * Concept Mastery Engine — deterministic 0-100 scoring. NEVER uses AI.
 */

export type MasteryInput = {
  total_attempts: number;
  correct_attempts: number;
  mistake_count: number;
  recovery_attempts?: number;
  recovery_correct?: number;
  previous_score?: number;
};

export type MasteryResult = {
  mastery_score: number;
  trend: "improving" | "slipping" | "steady";
  recovery_completion_pct: number;
};

export function computeMasteryScore(input: MasteryInput): number {
  const attempts = Math.max(input.total_attempts, 1);
  const accuracyComponent = (input.correct_attempts / attempts) * 70;
  const mistakePenalty = Math.min(input.mistake_count * 4, 30);
  const recoveryBonus =
    input.recovery_attempts && input.recovery_attempts > 0
      ? ((input.recovery_correct ?? 0) / input.recovery_attempts) * 15
      : 0;

  const raw = accuracyComponent - mistakePenalty + recoveryBonus;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

export function computeMasteryTrend(
  current: number,
  previous?: number,
): "improving" | "slipping" | "steady" {
  if (previous == null) return "steady";
  if (current > previous + 3) return "improving";
  if (current < previous - 3) return "slipping";
  return "steady";
}

export function computeRecoveryCompletion(
  recoveryAttempts: number,
  recoveryCorrect: number,
): number {
  if (recoveryAttempts <= 0) return 0;
  return Math.round((recoveryCorrect / recoveryAttempts) * 1000) / 10;
}

export function computeFullMastery(input: MasteryInput): MasteryResult {
  const mastery_score = computeMasteryScore(input);
  const trend = computeMasteryTrend(mastery_score, input.previous_score);
  const recovery_completion_pct = computeRecoveryCompletion(
    input.recovery_attempts ?? 0,
    input.recovery_correct ?? 0,
  );
  return { mastery_score, trend, recovery_completion_pct };
}

/** Compact mastery summary for agents. */
export function buildMasterySummaryForAgents(
  items: {
    concept: string;
    subject: string;
    chapter?: string | null;
    mastery_score: number;
    mistake_count?: number;
  }[],
) {
  const weak = items.filter((m) => m.mastery_score < 60).slice(0, 8);
  const strong = items.filter((m) => m.mastery_score >= 75).slice(0, 6);
  const avg = items.length
    ? Math.round(items.reduce((s, m) => s + m.mastery_score, 0) / items.length)
    : 0;
  return { avg_mastery: avg, weak_concepts: weak, strong_concepts: strong, total_tracked: items.length };
}
