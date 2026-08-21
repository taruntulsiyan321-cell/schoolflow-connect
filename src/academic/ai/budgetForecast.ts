/**
 * Production-oriented budget forecast from decision ledger / usage snapshots.
 * Pure math — no invented demo burn rates.
 */

export type DailyUsagePoint = {
  /** YYYY-MM-DD (UTC) */
  day: string;
  units: number;
};

export type BudgetForecastInput = {
  /** Observed daily burn (oldest → newest or unsorted). */
  daily_usage: DailyUsagePoint[];
  soft_limit_daily: number;
  hard_limit_daily: number;
  /** Days remaining in the billing/ops month (including today). */
  days_remaining_in_month: number;
  /** Soft monthly ceiling when known; else derived from daily soft × 30. */
  soft_limit_monthly?: number;
  /** Units already used this month. */
  month_units_used?: number;
  /** As-of timestamp for the forecast. */
  as_of?: string;
};

export type BudgetForecast = {
  as_of: string;
  observed_days: number;
  avg_daily_units: number;
  projected_month_end_units: number;
  soft_limit_monthly: number;
  hard_limit_daily: number;
  soft_limit_daily: number;
  /** Fraction of monthly soft projected to be used (0–1+). */
  projected_soft_pct: number;
  /** Calendar days until projected hit of soft monthly (null if not trending to hit). */
  days_to_soft_breach: number | null;
  days_to_hard_daily_breach: number | null;
  at_or_above_80_pct: boolean;
  at_or_above_90_pct: boolean;
  at_or_above_100_pct: boolean;
  status: "ok" | "watch" | "warn" | "critical" | "insufficient_data";
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * projected_soft_pct is a FRACTION (0-1+), not a raw unit count -- round1's
 * 1-decimal-place rounding is coarse enough on a 0-1 scale to mean "nearest
 * 10 percentage points", silently flattening any real usage under 5% to a
 * flat 0. AiAnalytics.tsx's own display already does finer rounding
 * (`Math.round(pct * 1000) / 10` -> 0.1% precision), so this needs to
 * preserve at least that much precision going in. Reproduced live: 147
 * projected units against a 6000 soft cap (2.45%) displayed as "0%".
 */
function roundPct(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Forecast burn from observed decision/usage ledger points.
 * Empty history → insufficient_data with zeros (never invents demo burn).
 */
export function forecastBudget(input: BudgetForecastInput): BudgetForecast {
  const as_of = input.as_of ?? new Date().toISOString();
  const softMonthly =
    input.soft_limit_monthly ??
    Math.max(0, input.soft_limit_daily) * 30;
  const monthUsed = Math.max(0, input.month_units_used ?? 0);
  const daysLeft = Math.max(0, Math.floor(input.days_remaining_in_month));

  const points = (input.daily_usage ?? []).filter(
    (p) => p && typeof p.units === "number" && Number.isFinite(p.units) && p.units >= 0,
  );

  if (points.length === 0) {
    return {
      as_of,
      observed_days: 0,
      avg_daily_units: 0,
      projected_month_end_units: monthUsed,
      soft_limit_monthly: softMonthly,
      hard_limit_daily: input.hard_limit_daily,
      soft_limit_daily: input.soft_limit_daily,
      projected_soft_pct: softMonthly > 0 ? roundPct(monthUsed / softMonthly) : 0,
      days_to_soft_breach: null,
      days_to_hard_daily_breach: null,
      at_or_above_80_pct: softMonthly > 0 && monthUsed / softMonthly >= 0.8,
      at_or_above_90_pct: softMonthly > 0 && monthUsed / softMonthly >= 0.9,
      at_or_above_100_pct: softMonthly > 0 && monthUsed / softMonthly >= 1,
      status: "insufficient_data",
    };
  }

  const total = points.reduce((s, p) => s + p.units, 0);
  const avg = total / points.length;
  const projected = monthUsed + avg * daysLeft;
  const softPct = softMonthly > 0 ? projected / softMonthly : 0;

  let days_to_soft_breach: number | null = null;
  if (avg > 0 && softMonthly > monthUsed) {
    days_to_soft_breach = Math.ceil((softMonthly - monthUsed) / avg);
  } else if (softMonthly > 0 && monthUsed >= softMonthly) {
    days_to_soft_breach = 0;
  }

  let days_to_hard_daily_breach: number | null = null;
  if (avg > 0 && input.hard_limit_daily > 0 && avg >= input.hard_limit_daily) {
    days_to_hard_daily_breach = 0;
  }

  let status: BudgetForecast["status"] = "ok";
  if (softPct >= 1 || days_to_hard_daily_breach === 0) status = "critical";
  else if (softPct >= 0.9) status = "warn";
  else if (softPct >= 0.8) status = "watch";

  return {
    as_of,
    observed_days: points.length,
    avg_daily_units: round1(avg),
    projected_month_end_units: round1(projected),
    soft_limit_monthly: softMonthly,
    hard_limit_daily: input.hard_limit_daily,
    soft_limit_daily: input.soft_limit_daily,
    projected_soft_pct: roundPct(softPct),
    days_to_soft_breach,
    days_to_hard_daily_breach,
    at_or_above_80_pct: softPct >= 0.8,
    at_or_above_90_pct: softPct >= 0.9,
    at_or_above_100_pct: softPct >= 1,
    status,
  };
}

/**
 * Collapse decision rows with estimated_cost_units / evidence.cost_units into daily points.
 */
export function dailyUsageFromDecisions(
  rows: {
    created_at?: string | null;
    used_model?: boolean;
    estimated_cost_units?: number | null;
    evidence?: { cost_units?: number } | null;
  }[],
): DailyUsagePoint[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const iso = r.created_at;
    if (!iso) continue;
    const day = iso.slice(0, 10);
    let units = 0;
    if (typeof r.estimated_cost_units === "number" && Number.isFinite(r.estimated_cost_units)) {
      units = r.estimated_cost_units;
    } else if (typeof r.evidence?.cost_units === "number") {
      units = r.evidence.cost_units;
    } else if (r.used_model) {
      units = 1;
    }
    byDay.set(day, (byDay.get(day) ?? 0) + units);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, units]) => ({ day, units }));
}
