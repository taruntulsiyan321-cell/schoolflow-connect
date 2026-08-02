/**
 * Prompt Evaluation Framework scaffold — draft→benchmark→shadow→A/B→production.
 * Feedback can trigger re-eval candidates; never auto-promotes.
 */

import type { PromptStatus } from "./promptLibrary";

export type PromptEvalStatus =
  | "draft"
  | "offline_benchmark"
  | "shadow"
  | "ab_test"
  | "production"
  | "retired";

/** Map legacy Phase-2 statuses onto eval lifecycle. */
export function normalizePromptEvalStatus(status: string): PromptEvalStatus {
  if (status === "shadow") return "shadow";
  if (status === "production") return "production";
  if (status === "retired") return "retired";
  if (status === "offline_benchmark") return "offline_benchmark";
  if (status === "ab_test") return "ab_test";
  return "draft";
}

const TRANSITIONS: Record<PromptEvalStatus, PromptEvalStatus[]> = {
  draft: ["offline_benchmark", "retired"],
  offline_benchmark: ["shadow", "draft", "retired"],
  shadow: ["ab_test", "offline_benchmark", "retired"],
  ab_test: ["production", "shadow", "retired"],
  production: ["retired", "shadow"],
  retired: ["draft"],
};

export function canTransitionPromptStatus(
  from: PromptEvalStatus | PromptStatus,
  to: PromptEvalStatus,
): boolean {
  const f = normalizePromptEvalStatus(from);
  return (TRANSITIONS[f] ?? []).includes(to);
}

export type PromotePromptInput = {
  capability_id: string;
  version: string;
  to_status: PromptEvalStatus;
  rollback_version?: string | null;
  benchmark_run_ids?: string[] | null;
  scorecard?: Record<string, unknown> | null;
};

export function assertPromotionAllowed(input: {
  from: PromptEvalStatus | PromptStatus;
  to: PromptEvalStatus;
  scorecard?: Record<string, unknown> | null;
  benchmark_run_ids?: string[] | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!canTransitionPromptStatus(input.from, input.to)) {
    return {
      ok: false,
      reason: `invalid transition ${normalizePromptEvalStatus(input.from)} → ${input.to}`,
    };
  }
  if (input.to === "production") {
    const gate =
      input.scorecard &&
      (input.scorecard.gate_passed === true ||
        input.scorecard["gate_passed"] === true);
    const runs = input.benchmark_run_ids?.length ?? 0;
    if (!gate && runs === 0) {
      return {
        ok: false,
        reason: "production promotion requires benchmark gate evidence",
      };
    }
  }
  return { ok: true };
}

/** Feedback never auto-promotes — only marks candidate for re-evaluation. */
export function feedbackMayTriggerReevaluation(signal: string): boolean {
  return [
    "reject",
    "dislike",
    "not_useful",
    "edit",
    "correction",
    "retry",
  ].includes(signal);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function promotePromptVersion(client: any, input: PromotePromptInput) {
  // Soft client-side production gate; RPC enforces full transition rules.
  if (input.to_status === "production") {
    const gate =
      input.scorecard &&
      (input.scorecard.gate_passed === true || input.scorecard["gate_passed"] === true);
    const runs = input.benchmark_run_ids?.length ?? 0;
    if (!gate && runs === 0) {
      return {
        ok: false as const,
        error: "production promotion requires benchmark gate evidence",
      };
    }
  }

  const { data, error } = await client.rpc("ai_prompt_promote", {
    p_capability_id: input.capability_id,
    p_version: input.version,
    p_to_status: input.to_status,
    p_rollback_version: input.rollback_version ?? null,
    p_benchmark_run_ids: input.benchmark_run_ids ?? null,
    p_scorecard: input.scorecard ?? null,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}
