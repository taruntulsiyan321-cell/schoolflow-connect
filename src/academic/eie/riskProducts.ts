/**
 * EIE risk / consistency products derived from Academic Engine profile facts.
 * Deterministic thresholds only — LLM never invents these scores.
 */

export type RiskBand = "low" | "moderate" | "elevated" | "high" | "unknown";

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
  if (score >= 75) return "high";
  if (score >= 55) return "elevated";
  if (score >= 35) return "moderate";
  return "low";
}

function bandFromConsistency(score: number): RiskBand {
  // For consistency, invert language: high score = healthy (low risk band)
  if (score >= 85) return "low";
  if (score >= 70) return "moderate";
  if (score >= 50) return "elevated";
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
