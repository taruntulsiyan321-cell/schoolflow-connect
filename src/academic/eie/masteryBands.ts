/**
 * Educational Intelligence Engine — mastery band thresholds.
 * LLM must never recalculate these; bands are derived from AE concept_mastery scores.
 */

export const EIE_ALGORITHM_ID = "eie.mastery.v1";

export type MasteryBand = "critical" | "weak" | "developing" | "strong" | "mastered";

/** Thresholds aligned with conceptMasteryEngine agent summary (weak < 60, strong >= 75). */
export const MASTERY_THRESHOLDS = {
  criticalMax: 40,
  weakMax: 60,
  developingMax: 75,
  strongMax: 90,
  // mastered: > 90
} as const;

export function bandFromScore(score: number): MasteryBand {
  const s = Number.isFinite(score) ? score : 0;
  if (s < MASTERY_THRESHOLDS.criticalMax) return "critical";
  if (s < MASTERY_THRESHOLDS.weakMax) return "weak";
  if (s < MASTERY_THRESHOLDS.developingMax) return "developing";
  if (s < MASTERY_THRESHOLDS.strongMax) return "strong";
  return "mastered";
}

export function isWeakBand(band: MasteryBand): boolean {
  return band === "critical" || band === "weak";
}

export function isStrongBand(band: MasteryBand): boolean {
  return band === "strong" || band === "mastered";
}
