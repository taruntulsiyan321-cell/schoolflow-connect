/**
 * AI Analytics Dashboard v1 — aggregate ai_request_decisions (backend).
 * Pure aggregators for tests; DB RPC / service loaders for live data.
 */

export type DecisionRow = {
  feature_id: string;
  route_class: string;
  decision: string;
  used_model: boolean;
  cache_hit: boolean;
  confidence?: number | null;
  latency_ms?: number | null;
  evidence?: Record<string, unknown> | null;
  created_at?: string;
};

export type AiAnalyticsSummary = {
  window: { from: string | null; to: string | null; count: number };
  route_mix: Record<string, number>;
  decision_mix: Record<string, number>;
  feature_mix: Record<string, number>;
  model_calls: number;
  cache_hits: number;
  deflection_pct: number;
  avg_confidence: number | null;
  avg_latency_ms: number | null;
  estimated_cost_units: number;
  low_confidence_rate: number | null;
};

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Aggregate decision rows — no demo padding; empty input → zeros.
 */
export function aggregateAiDecisions(
  rows: DecisionRow[],
  window: { from?: string | null; to?: string | null } = {},
): AiAnalyticsSummary {
  const route_mix: Record<string, number> = {};
  const decision_mix: Record<string, number> = {};
  const feature_mix: Record<string, number> = {};
  let model_calls = 0;
  let cache_hits = 0;
  let confSum = 0;
  let confN = 0;
  let latSum = 0;
  let latN = 0;
  let lowConf = 0;
  let cost = 0;

  for (const r of rows) {
    bump(route_mix, r.route_class || "unknown");
    bump(decision_mix, r.decision || "unknown");
    bump(feature_mix, r.feature_id || "unknown");
    if (r.used_model) model_calls += 1;
    if (r.cache_hit) cache_hits += 1;
    if (typeof r.confidence === "number" && Number.isFinite(r.confidence)) {
      confSum += r.confidence;
      confN += 1;
      if (r.confidence < 0.65) lowConf += 1;
    }
    if (typeof r.latency_ms === "number" && Number.isFinite(r.latency_ms)) {
      latSum += r.latency_ms;
      latN += 1;
    }
    const units = r.evidence?.cost_units;
    if (typeof units === "number" && Number.isFinite(units)) cost += units;
    else if (r.used_model) cost += 1;
  }

  const count = rows.length;
  const nonModel = count - model_calls;
  const deflection_pct = count ? Math.round((nonModel / count) * 1000) / 10 : 0;

  return {
    window: {
      from: window.from ?? null,
      to: window.to ?? null,
      count,
    },
    route_mix,
    decision_mix,
    feature_mix,
    model_calls,
    cache_hits,
    deflection_pct,
    avg_confidence: confN ? Math.round((confSum / confN) * 1000) / 1000 : null,
    avg_latency_ms: latN ? Math.round(latSum / latN) : null,
    estimated_cost_units: cost,
    low_confidence_rate: confN ? Math.round((lowConf / confN) * 1000) / 1000 : null,
  };
}

/**
 * Load aggregates from Supabase via RPC `ai_analytics_summary_v1` when available,
 * else client-side aggregation of `ai_request_decisions` (admin/principal).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAiAnalyticsSummary(
  client: any,
  opts: { schoolId: string; fromIso?: string; toIso?: string; limit?: number },
): Promise<AiAnalyticsSummary> {
  const fromIso = opts.fromIso ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const toIso = opts.toIso ?? new Date().toISOString();

  const rpc = await client.rpc("ai_analytics_summary_v1", {
    p_school_id: opts.schoolId,
    p_from: fromIso,
    p_to: toIso,
  });

  if (!rpc.error && rpc.data && typeof rpc.data === "object") {
    return rpc.data as AiAnalyticsSummary;
  }

  const { data } = await client
    .from("ai_request_decisions")
    .select(
      "feature_id, route_class, decision, used_model, cache_hit, confidence, latency_ms, evidence, created_at",
    )
    .eq("school_id", opts.schoolId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .limit(opts.limit ?? 5000);

  return aggregateAiDecisions((data as DecisionRow[] | null) ?? [], {
    from: fromIso,
    to: toIso,
  });
}
