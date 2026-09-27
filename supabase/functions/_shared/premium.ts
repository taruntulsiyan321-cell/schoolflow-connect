/**
 * Plan limits for individual (exam) accounts, as the edge functions ask them.
 *
 * The decision is the database's (`_premium_decide`, 20261111000000): whether
 * the account's plan has the feature, and — for a counted feature — whether a
 * use is left, counted in the same statement that checks it. This module only
 * calls it and shapes the refusal, so every function refuses the same way:
 *
 *   402 { error, error_code: "plan_limit", premium: <the decision> }
 *
 * `src/lib/premium.ts` is the one place the app recognises that answer.
 *
 * A school's student is never limited (the decision says `applies: false`).
 * While enforcement is off every decision is `ok` and still counted.
 *
 * FAIL CLOSED. If the decision cannot be read, the request is refused with a
 * 503 — not given away, and not reported as a plan limit either.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** A service-role client, for functions that have none of their own. */
export function premiumAdminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export type PremiumFeature =
  | "practice.question"
  | "analysis.topic"
  | "nova.message"
  | "mistake.explain"
  | "insights.report"
  | "custom_practice.upload"
  | "screen_capture.mistake"
  | "mock_test.start";

export type PremiumDecision = {
  ok: boolean;
  applies?: boolean;
  enforced?: boolean;
  tier?: string;
  feature: string;
  period?: string;
  period_key?: string;
  limit?: number | null;
  used?: number;
  remaining?: number | null;
  reason?: "not_in_plan" | "limit_reached" | null;
  would_deny?: string | null;
};

export class PremiumUnavailableError extends Error {}

async function decide(
  admin: SupabaseClient,
  fn: "premium_consume" | "premium_check",
  accountId: string,
  feature: PremiumFeature,
): Promise<PremiumDecision> {
  const args = fn === "premium_consume"
    ? { _account: accountId, _feature: feature, _units: 1 }
    : { _account: accountId, _feature: feature };
  const { data, error } = await admin.rpc(fn, args);
  if (error || !data || typeof (data as { ok?: unknown }).ok !== "boolean") {
    console.error(`${fn} failed — refusing (fail closed)`, error?.message ?? error ?? data);
    throw new PremiumUnavailableError("Plans could not be checked. Please try again.");
  }
  return data as PremiumDecision;
}

/** Count one use of a counted feature, or learn it is refused. */
export function premiumConsume(admin: SupabaseClient, accountId: string, feature: PremiumFeature) {
  return decide(admin, "premium_consume", accountId, feature);
}

/** Ask whether a feature is in the plan (and a use is left) without counting. */
export function premiumCheck(admin: SupabaseClient, accountId: string, feature: PremiumFeature) {
  return decide(admin, "premium_check", accountId, feature);
}

/**
 * Give back a use counted for something that then did not happen. Never
 * throws: a failed release costs the student one use, which is logged, and
 * must not turn a response the student already has into an error.
 */
export async function premiumRelease(admin: SupabaseClient, accountId: string, decision: PremiumDecision) {
  if (!decision.applies || !decision.period_key || decision.period === "none") return;
  const { error } = await admin.rpc("premium_release", {
    _account: accountId,
    _feature: decision.feature,
    _period_key: decision.period_key,
    _units: 1,
  });
  if (error) console.error("premium_release failed", decision.feature, error.message ?? error);
}

const FEATURE_NAMES: Record<string, string> = {
  "practice.question": "practice questions",
  "analysis.topic": "topic-wise analysis",
  "nova.message": "Nova messages",
  "mistake.explain": "Explain my mistake",
  "insights.report": "the insights coach",
  "custom_practice.upload": "Custom Practice uploads",
  "screen_capture.mistake": "screen captures",
  "mock_test.start": "mock tests",
};

const PERIOD_NAMES: Record<string, string> = {
  day: "today's",
  month: "this month's",
  lifetime: "your",
};

/** The sentence a student reads when a plan refuses. */
export function planLimitMessage(d: PremiumDecision): string {
  const what = FEATURE_NAMES[d.feature] ?? d.feature;
  if (d.reason === "limit_reached" && typeof d.limit === "number") {
    const period = PERIOD_NAMES[d.period ?? ""] ?? "your";
    return `You've used ${period} ${d.limit} ${what}. Upgrade your plan for more.`;
  }
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} ${what.endsWith("s") ? "are" : "is"} not in your plan. Upgrade to use ${what === "Explain my mistake" ? "it" : "them"}.`;
}

/** The one refusal every gated function sends. */
export function planLimitResponse(d: PremiumDecision, headers: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: planLimitMessage(d), error_code: "plan_limit", premium: d }),
    { status: 402, headers: { ...headers, "Content-Type": "application/json" } },
  );
}

/** The refusal when the decision itself could not be read. */
export function premiumUnavailableResponse(headers: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: "Plans could not be checked. Please try again.", error_code: "premium_unavailable" }),
    { status: 503, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
