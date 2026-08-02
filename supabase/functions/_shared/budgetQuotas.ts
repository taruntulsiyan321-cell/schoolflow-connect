/**
 * Budget quotas v1 — soft limits per school / feature.
 * Enforcement stub: pure check against usage counters (edge wires DB).
 */

export type BudgetPeriod = "daily" | "monthly";

export type BudgetQuota = {
  school_id: string;
  scope: "school" | "feature";
  feature_id: string | null;
  period: BudgetPeriod;
  soft_limit_units: number;
  hard_limit_units: number | null;
};

export type BudgetUsage = {
  school_id: string;
  feature_id: string | null;
  period: BudgetPeriod;
  period_key: string;
  units_used: number;
};

export type BudgetCheckResult =
  | { ok: true; soft_breach: boolean; units_used: number; soft_limit: number; hard_limit: number | null }
  | {
      ok: false;
      soft_breach: true;
      hard_breach: true;
      units_used: number;
      soft_limit: number;
      hard_limit: number;
      error_code: "budget_exhausted";
    };

/** Default soft caps (generative call units). Deterministic paths do not consume. */
export const DEFAULT_SCHOOL_DAILY_SOFT = 200;
export const DEFAULT_SCHOOL_MONTHLY_SOFT = 3000;
export const DEFAULT_FEATURE_DAILY_SOFT: Record<string, number> = {
  "student.performance.explain": 80,
  "parent.child.narrative": 40,
};

export function periodKey(period: BudgetPeriod, at = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  if (period === "monthly") return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

/**
 * Check whether a generative reservation of `units` is allowed.
 * Soft breach → ok but flagged (downgrade tier). Hard breach → deny generative.
 */
export function checkBudgetReservation(input: {
  quotas: BudgetQuota[];
  usage: BudgetUsage[];
  school_id: string;
  feature_id: string;
  units?: number;
  at?: Date;
}): BudgetCheckResult {
  const units = input.units ?? 1;
  const at = input.at ?? new Date();

  const schoolDaily =
    input.quotas.find(
      (q) =>
        q.school_id === input.school_id &&
        q.scope === "school" &&
        q.period === "daily" &&
        !q.feature_id,
    ) ?? null;
  const featureDaily =
    input.quotas.find(
      (q) =>
        q.school_id === input.school_id &&
        q.scope === "feature" &&
        q.period === "daily" &&
        q.feature_id === input.feature_id,
    ) ?? null;

  const soft =
    featureDaily?.soft_limit_units ??
    schoolDaily?.soft_limit_units ??
    DEFAULT_FEATURE_DAILY_SOFT[input.feature_id] ??
    DEFAULT_SCHOOL_DAILY_SOFT;
  const hard =
    featureDaily?.hard_limit_units ??
    schoolDaily?.hard_limit_units ??
    soft * 2;

  const dayKey = periodKey("daily", at);
  const schoolUsed =
    input.usage.find(
      (u) =>
        u.school_id === input.school_id &&
        u.period === "daily" &&
        u.period_key === dayKey &&
        u.feature_id == null,
    )?.units_used ?? 0;
  const featureUsed =
    input.usage.find(
      (u) =>
        u.school_id === input.school_id &&
        u.period === "daily" &&
        u.period_key === dayKey &&
        u.feature_id === input.feature_id,
    )?.units_used ?? 0;

  // Enforce the tighter of school-wide and feature counters against soft/hard
  const units_used = Math.max(schoolUsed, featureUsed);
  const projected = units_used + units;

  if (projected > hard) {
    return {
      ok: false,
      soft_breach: true,
      hard_breach: true,
      units_used,
      soft_limit: soft,
      hard_limit: hard,
      error_code: "budget_exhausted",
    };
  }

  return {
    ok: true,
    soft_breach: projected > soft,
    units_used,
    soft_limit: soft,
    hard_limit: hard,
  };
}

/** Estimated cost units for a tiered generative call (relative, not INR). */
export function estimateUnitsForTier(tier: "simple" | "medium" | "complex" | "enterprise"): number {
  switch (tier) {
    case "simple":
      return 1;
    case "medium":
      return 2;
    case "complex":
      return 4;
    case "enterprise":
      return 10;
  }
}
