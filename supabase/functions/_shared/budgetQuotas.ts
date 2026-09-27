/**
 * Budget quotas v1 — soft limits per school / feature.
 * Enforcement stub: pure check against usage counters (edge wires DB).
 */




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
