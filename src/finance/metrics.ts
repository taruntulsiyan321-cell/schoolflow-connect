/**
 * FINANCE thresholds. Deliberately a separate module from
 * `src/academic/metrics/`, and deliberately with its own band type.
 *
 * WHY NOT IN academic/metrics/thresholds.ts
 *
 * Fee collection is money, not learning. It shares nothing with attendance,
 * homework or marks except the accident of being a percentage — and that
 * accident is exactly how a number ends up with two meanings. The moment
 * FEE_COLLECTION_HEALTHY sat beside ATTENDANCE_COMFORTABLE, some later sweep
 * would notice they were both "the comfortable rung" and try to reconcile them.
 *
 * WHY ITS OWN BAND TYPE
 *
 * `Band` from academic/metrics/bands.ts is structurally identical to what this
 * needs, so reusing it would compile. That is the problem: a fee-collection
 * band would then be assignable anywhere an attendance band is expected, and
 * §4.2b's rule — band names do not travel across measures — would hold only by
 * everyone remembering it. FeeCollectionBand is a distinct name so the
 * distinction is visible at every call site.
 *
 * These were bare literals in FinancialReportsPage.tsx (`rate >= 80`,
 * `rate >= 50`) and are real thresholds, just in the wrong neighbourhood.
 */

/** Percent of due fees collected. At or above this, collection is healthy. */
export const FEE_COLLECTION_HEALTHY = 80;

/** Percent of due fees collected. Below this, collection is a problem. */
export const FEE_COLLECTION_LOW = 50;

/**
 * How a collection rate is drawn. NOT interchangeable with the academic
 * `Band` — the rungs describe money recovered, not a child's standing.
 *
 * `unknown` exists for the same reason it does in the academic bands: nothing
 * billed yet is an UNKNOWN rate, not a rate of zero, and `null < 50` is true
 * in JavaScript.
 */
export type FeeCollectionBand = "unknown" | "low" | "partial" | "healthy";

export function feeCollectionBand(
  ratePct: number | null | undefined,
): FeeCollectionBand {
  if (ratePct === null || ratePct === undefined || !Number.isFinite(ratePct)) {
    return "unknown";
  }
  if (ratePct >= FEE_COLLECTION_HEALTHY) return "healthy";
  if (ratePct >= FEE_COLLECTION_LOW) return "partial";
  return "low";
}

/** Every finance threshold, for a gate that proves nothing redeclares one. */
export const FINANCE_THRESHOLDS = {
  FEE_COLLECTION_HEALTHY,
  FEE_COLLECTION_LOW,
} as const;
