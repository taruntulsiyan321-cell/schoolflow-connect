/**
 * EIE risk / consistency products derived from Academic Engine profile facts.
 * Deterministic thresholds only — LLM never invents these scores.
 */

export type RiskBand = "low" | "moderate" | "elevated" | "high" | "unknown";

/**
 * RISK: higher score = more risk. A student's standing.
 *
 * Named because three ladders in this package all produced a RiskBand from
 * different boundaries, so "elevated" meant >= 55 here, >= 50 in
 * doubtUrgency.ts, and the 50-70 band in bandFromConsistency below. Four words,
 * three meanings, one type. The words are only comparable if the numbers are
 * visible.
 */
export const RISK_SCORE_HIGH = 75;
export const RISK_SCORE_ELEVATED = 55;
export const RISK_SCORE_MODERATE = 35;

/**
 * CONSISTENCY: INVERTED — a higher score is HEALTHIER, so the ladder runs the
 * other way. Deliberately not sharing RISK_SCORE_*: reusing those constants
 * here would read as agreement while meaning the opposite.
 */
export const CONSISTENCY_HEALTHY = 85;
export const CONSISTENCY_MODERATE = 70;
export const CONSISTENCY_ELEVATED = 50;

export type AttendanceRiskProduct = {
  product: "attendance_risk";
  attendance_pct: number | null;
  risk_score: number;
  band: RiskBand;
  reason_codes: string[];
};

export type HomeworkConsistencyProduct = {
  product: "homework_consistency";
  homework_completion_pct: number | null;
  consistency_score: number;
  band: RiskBand;
  reason_codes: string[];
};

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bandFromRiskScore(score: number): RiskBand {
  if (score >= RISK_SCORE_HIGH) return "high";
  if (score >= RISK_SCORE_ELEVATED) return "elevated";
  if (score >= RISK_SCORE_MODERATE) return "moderate";
  return "low";
}

function bandFromConsistency(score: number): RiskBand {
  // For consistency, invert language: high score = healthy (low risk band)
  if (score >= CONSISTENCY_HEALTHY) return "low";
  if (score >= CONSISTENCY_MODERATE) return "moderate";
  if (score >= CONSISTENCY_ELEVATED) return "elevated";
  return "high";
}

/**
 * Attendance risk from AE attendance_pct. Missing data → unknown / score 0.
 */
export function computeAttendanceRisk(
  attendance_pct: number | null | undefined,
): AttendanceRiskProduct {
  if (attendance_pct == null || !Number.isFinite(attendance_pct)) {
    return {
      product: "attendance_risk",
      attendance_pct: null,
      risk_score: 0,
      band: "unknown",
      reason_codes: ["attendance_data_missing"],
    };
  }
  const pct = Math.max(0, Math.min(100, Number(attendance_pct)));
  // Risk rises as attendance falls below 95
  const risk_score = clampScore((95 - pct) * (100 / 45));
  const reason_codes: string[] = [];
  if (pct < 75) reason_codes.push("attendance_critical_threshold");
  else if (pct < 85) reason_codes.push("attendance_watch_threshold");
  else if (pct < 95) reason_codes.push("attendance_soft_gap");
  else reason_codes.push("attendance_healthy");

  return {
    product: "attendance_risk",
    attendance_pct: pct,
    risk_score,
    band: bandFromRiskScore(risk_score),
    reason_codes,
  };
}

/**
 * Homework consistency from AE homework_completion_pct.
 */
export function computeHomeworkConsistency(
  homework_completion_pct: number | null | undefined,
): HomeworkConsistencyProduct {
  if (homework_completion_pct == null || !Number.isFinite(homework_completion_pct)) {
    return {
      product: "homework_consistency",
      homework_completion_pct: null,
      consistency_score: 0,
      band: "unknown",
      reason_codes: ["homework_data_missing"],
    };
  }
  const pct = Math.max(0, Math.min(100, Number(homework_completion_pct)));
  const consistency_score = clampScore(pct);
  const reason_codes: string[] = [];
  if (pct < 50) reason_codes.push("homework_critical");
  else if (pct < 70) reason_codes.push("homework_inconsistent");
  else if (pct < 85) reason_codes.push("homework_developing");
  else reason_codes.push("homework_consistent");

  return {
    product: "homework_consistency",
    homework_completion_pct: pct,
    consistency_score,
    band: bandFromConsistency(consistency_score),
    reason_codes,
  };
}
