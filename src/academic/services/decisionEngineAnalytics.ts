/**
 * Decision Engine rollout observability -- admin/principal read of the
 * (still flag-gated, default-off) Weak Areas V2 pilot's health. Reads
 * rpc_decision_engine_rollout_summary_v1, which aggregates the
 * practice.weak_areas.path_used / .v2_failed events practiceService.ts
 * emits. Named/shaped for the whole Decision Engine, not just Weak Areas --
 * future engines (Revision, Recovery, Nova) are expected to add sibling
 * keys alongside "weak_areas" without a shape change here.
 */

export type WeakAreasRolloutMetrics = {
  v1_uses: number;
  v2_uses: number;
  v2_failures: number;
  v2_empty_results: number;
  v2_total_recommendations: number;
  v2_students_with_recommendations: number;
  v2_failure_rate: number | null; // percent, one decimal
  v2_empty_result_rate: number | null; // percent, one decimal
};

export type DecisionEngineRolloutSummary = {
  window: { from: string; to: string };
  weak_areas: WeakAreasRolloutMetrics;
};

/**
 * Load the rollout summary from rpc_decision_engine_rollout_summary_v1.
 *
 * Deliberately RPC-only, no raw-table fallback (unlike
 * fetchAiAnalyticsSummary's fallback to a raw `.from(...)` query): that
 * fallback exists there for a rolling-deploy window where the RPC
 * migration might lag the client. Here the SQL migration and this function
 * ship in the same change, so that window never exists -- a fallback would
 * just duplicate the SQL's aggregation logic in TS for no real benefit.
 * Throws on error; the caller renders its own error state.
 */
export async function fetchDecisionEngineRolloutSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  opts: { fromIso?: string; toIso?: string } = {},
): Promise<DecisionEngineRolloutSummary> {
  const { data, error } = await client.rpc("rpc_decision_engine_rollout_summary_v1", {
    p_from: opts.fromIso ?? null,
    p_to: opts.toIso ?? null,
  });
  if (error) {
    throw new Error(error.message || "Failed to load Decision Engine rollout summary");
  }
  return data as DecisionEngineRolloutSummary;
}
