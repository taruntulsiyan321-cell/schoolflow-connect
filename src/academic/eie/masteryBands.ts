/**
 * Educational Intelligence Engine — mastery band thresholds.
 * LLM must never recalculate these; bands are derived from AE concept_mastery scores.
 */

export const EIE_ALGORITHM_ID = "eie.mastery.v1";

/**
 * §10.8, as ruled: a band may describe the FIGURE, never the child, and no band
 * may read strong / mastered / proficient / excellent. "high" and "very_high"
 * describe where the number sits; "strong" and "mastered" told a student what
 * they had become.
 *
 * The rename is the smaller half of this change. The larger half is that
 * nothing filters on the top of this scale any more — see the removal of
 * isStrongBand below.
 */
export type MasteryBand = "critical" | "weak" | "developing" | "high" | "very_high";

/** Thresholds aligned with conceptMasteryEngine agent summary (weak < 60, high >= 75). */
export const MASTERY_THRESHOLDS = {
  criticalMax: 40,
  weakMax: 60,
  developingMax: 75,
  highMax: 90,
  // very_high: > 90
} as const;

/** Product SSOT for weak-concept UI / Recovery / Nova / Practice weak mode. */
export const WEAK_CONCEPT_THRESHOLD = MASTERY_THRESHOLDS.weakMax;

export function bandFromScore(score: number): MasteryBand {
  const s = Number.isFinite(score) ? score : 0;
  if (s < MASTERY_THRESHOLDS.criticalMax) return "critical";
  if (s < MASTERY_THRESHOLDS.weakMax) return "weak";
  if (s < MASTERY_THRESHOLDS.developingMax) return "developing";
  if (s < MASTERY_THRESHOLDS.highMax) return "high";
  return "very_high";
}

export function isWeakBand(band: MasteryBand): boolean {
  return band === "critical" || band === "weak";
}

/**
 * isStrongBand is DELETED, not renamed.
 *
 * §10.8's ruling is that a figure is not forbidden for being high — filtering to
 * the best of them is. This predicate existed for exactly one caller, which used
 * it to select a student's top concepts into strong_concepts. Renaming it to
 * isHighBand would have kept the capability and moved the violation one
 * identifier away.
 *
 * isWeakBand stays: the product surfaces weaknesses, and that is the whole
 * asymmetry §10.8 describes.
 */
