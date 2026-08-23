/**
 * Minimal AI Analytics read panel for admin/principal — live decision ledger only.
 * No demo numbers; empty window shows zeros.
 */

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  dailyUsageFromDecisions,
  fetchAiAnalyticsSummary,
  forecastBudget,
  type AiAnalyticsSummary,
  type BudgetForecast,
} from "@/academic/ai";
import {
  fetchDecisionEngineRolloutSummary,
  type DecisionEngineRolloutSummary,
} from "@/academic/services/decisionEngineAnalytics";
import { cn } from "./shared";
import { toEnumLabel, toErrorMessage } from "@/lib/presentation";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-black/8 bg-muted px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
      <div className="mt-1 text-xl font-black text-foreground tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export default function AiAnalyticsPanel() {
  const { schoolId } = useAuth();
  const [summary, setSummary] = useState<AiAnalyticsSummary | null>(null);
  const [forecast, setForecast] = useState<BudgetForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Decision Engine rollout section has its own state, deliberately kept
  // separate from the AI ledger's -- a failure here must not take down the
  // rest of this (already-working) panel.
  const [rollout, setRollout] = useState<DecisionEngineRolloutSummary | null>(null);
  const [rolloutError, setRolloutError] = useState<string | null>(null);
  const [rolloutLoading, setRolloutLoading] = useState(true);

  const load = async () => {
    if (!schoolId) {
      setSummary(null);
      setForecast(null);
      setLoading(false);
      setError("No school context");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fromIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const toIso = new Date().toISOString();
      const agg = await fetchAiAnalyticsSummary(supabase, {
        schoolId,
        fromIso,
        toIso,
      });
      setSummary(agg);

      const { data: rows, error: rowsError } = await supabase
        .from("ai_request_decisions")
        .select("created_at, used_model, estimated_cost_units, evidence")
        .eq("school_id", schoolId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .limit(5000);
      if (rowsError) throw rowsError;

      const daily = dailyUsageFromDecisions((rows as never[]) ?? []);
      const monthUsed = daily.reduce((s, d) => s + d.units, 0);
      const dayOfMonth = new Date().getUTCDate();
      const daysLeft = Math.max(1, 30 - dayOfMonth + 1);
      setForecast(
        forecastBudget({
          daily_usage: daily,
          soft_limit_daily: 200,
          hard_limit_daily: 400,
          days_remaining_in_month: daysLeft,
          month_units_used: monthUsed,
          soft_limit_monthly: 200 * 30,
        }),
      );
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load AI analytics"));
      setSummary(null);
      setForecast(null);
    } finally {
      setLoading(false);
    }
  };

  const loadRollout = async () => {
    setRolloutLoading(true);
    setRolloutError(null);
    try {
      const data = await fetchDecisionEngineRolloutSummary(supabase);
      setRollout(data);
    } catch (e) {
      setRolloutError(toErrorMessage(e, "Failed to load rollout summary"));
      setRollout(null);
    } finally {
      setRolloutLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadRollout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const mixEntries = (m: Record<string, number> | undefined) =>
    Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-foreground font-black text-lg">
            <Activity className="w-5 h-5 text-[#3b5bdb]" />
            AI Analytics
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            Live aggregates from the AI decision ledger for this school. Empty windows show zeros — never demo burn.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void load();
            void loadRollout();
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-black/5 hover:bg-black/10 px-3 py-2 text-xs font-bold text-foreground"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", (loading || rolloutLoading) && "animate-spin")} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading ledger…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Requests (7d)" value={summary?.window.count ?? 0} />
            <Stat
              label="Deflection"
              value={`${summary?.deflection_pct ?? 0}%`}
              hint="Non-model answers"
            />
            <Stat label="Model calls" value={summary?.model_calls ?? 0} />
            <Stat label="Cache hits" value={summary?.cache_hits ?? 0} />
            <Stat
              label="Avg confidence"
              value={summary?.avg_confidence == null ? "—" : summary.avg_confidence}
            />
            <Stat
              label="Avg latency"
              value={summary?.avg_latency_ms == null ? "—" : `${summary.avg_latency_ms} ms`}
            />
            <Stat
              label="Est. cost units"
              value={summary?.estimated_cost_units ?? 0}
            />
            <Stat
              label="Low-confidence rate"
              value={
                summary?.low_confidence_rate == null
                  ? "—"
                  : `${Math.round(summary.low_confidence_rate * 1000) / 10}%`
              }
            />
          </div>

          <div className="rounded-xl border border-black/8 bg-muted p-4">
            <div className="text-sm font-bold text-foreground mb-2">Budget forecast</div>
            <p className="text-[10px] text-muted-foreground mb-3">
              Soft/hard limits below are provisional product defaults (not school-configured quotas).
            </p>
            {!forecast || forecast.status === "insufficient_data" ? (
              <p className="text-sm text-muted-foreground">
                Insufficient ledger history to forecast. Status: {forecast?.status ?? "—"}.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Avg daily units" value={forecast.avg_daily_units} />
                <Stat label="Projected month-end" value={forecast.projected_month_end_units} />
                <Stat
                  label="Vs provisional soft"
                  value={`${Math.round(forecast.projected_soft_pct * 1000) / 10}%`}
                  hint="Default soft cap — not school policy"
                />
                <Stat label="Status" value={toEnumLabel(forecast.status, "budget_forecast_status")} />
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {(
              [
                ["Route mix", summary?.route_mix],
                ["Decision mix", summary?.decision_mix],
                ["Feature mix", summary?.feature_mix],
              ] as const
            ).map(([title, mix]) => (
              <div key={title} className="rounded-xl border border-black/8 bg-muted p-4">
                <div className="text-sm font-bold text-foreground mb-3">{title}</div>
                {mixEntries(mix).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No rows in window.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {mixEntries(mix).slice(0, 8).map(([k, v]) => (
                      <li key={k} className="flex justify-between text-xs text-muted-foreground">
                        <span className="truncate pr-2">{k}</span>
                        <span className="tabular-nums text-foreground font-bold">{v}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rounded-xl border border-black/8 bg-muted p-4">
        <div className="text-sm font-bold text-foreground mb-1">Decision Engine Rollout — Weak Areas V2</div>
        <p className="text-[10px] text-muted-foreground mb-3">
          The pilot flag is off for every real student today. Read-only health of the V1/V2 split,
          for the separate decision of when to turn it on.
        </p>
        {rolloutLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading rollout summary…
          </div>
        ) : rolloutError ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {rolloutError}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="V1 uses (7d)" value={rollout?.weak_areas.v1_uses ?? 0} />
            <Stat
              label="V2 uses (7d)"
              value={rollout?.weak_areas.v2_uses ?? 0}
              hint={
                rollout?.weak_areas.v2_failure_rate == null
                  ? undefined
                  : `Failure rate ${rollout.weak_areas.v2_failure_rate}%`
              }
            />
            <Stat
              label="Empty results"
              value={rollout?.weak_areas.v2_empty_results ?? 0}
              hint={
                rollout?.weak_areas.v2_empty_result_rate == null
                  ? undefined
                  : `Empty rate ${rollout.weak_areas.v2_empty_result_rate}%`
              }
            />
            <Stat
              label="Students with recommendations"
              value={`${rollout?.weak_areas.v2_students_with_recommendations ?? 0} / ${rollout?.weak_areas.v2_uses ?? 0}`}
            />
            <Stat label="Total recommendations" value={rollout?.weak_areas.v2_total_recommendations ?? 0} />
          </div>
        )}
      </div>
    </div>
  );
}