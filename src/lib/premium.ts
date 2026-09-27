/**
 * Plans for individual (exam) accounts, as the app sees them.
 *
 * The database decides (premium_limits, _premium_decide — 20261111000000);
 * this module only reads the decision and presents it. It is the ONE place
 * the app recognises a plan refusal, whatever door it came through:
 *
 *   an edge function      402 { error_code: "plan_limit", premium, error }
 *   the Nova gateway      { decision: "plan_limit", premium, message }
 *   a database RPC        { message: "plan_limit:<feature>", details: <decision JSON> }
 *
 * BUYING. Payments go through Razorpay on the web only. The Android app
 * bundles this code but shows no price and no way to buy: Google Play
 * requires its own billing for digital features bought in an app, so
 * `canBuyInThisApp()` is false there and every buy control is hidden.
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { readEdgeFunctionError } from "@/lib/edgeFunctionError";
import { toErrorMessage } from "@/lib/presentation";

export type PremiumFeature =
  | "practice.question"
  | "analysis.topic"
  | "nova.message"
  | "mistake.explain"
  | "insights.report"
  | "custom_practice.upload"
  | "screen_capture.mistake"
  | "mock_test.start";

export type PremiumPeriod = "day" | "month" | "lifetime" | "none";

/** One feature as the database decided it for the caller. */
export type PremiumDecision = {
  ok: boolean;
  applies?: boolean;
  enforced?: boolean;
  tier?: string;
  feature: string;
  description?: string;
  period?: PremiumPeriod;
  period_key?: string;
  limit?: number | null;
  used?: number;
  remaining?: number | null;
  reason?: "not_in_plan" | "limit_reached" | null;
  would_deny?: "not_in_plan" | "limit_reached" | null;
};

export type PremiumTier = {
  code: string;
  rank: number;
  display_name: string;
  limits: { feature: string; period: PremiumPeriod; limit: number | null }[];
};

export type PremiumProduct = {
  code: string;
  tier: string;
  amount_paise: number;
  currency: string;
  validity_days: number;
  display_name: string;
};

export type PremiumStatus =
  | { individual: false }
  | {
      individual: true;
      enforced: boolean;
      sales_enabled: boolean;
      terms_version: string;
      tier: string;
      tier_rank: number;
      tier_until: string | null;
      entitlements: { tier: string; starts_at: string; ends_at: string; source: string }[];
      features: PremiumDecision[];
      tiers: PremiumTier[];
      products: PremiumProduct[];
    };

/** A refusal, ready to show. */
export type PlanLimit = {
  feature: string;
  reason: "not_in_plan" | "limit_reached";
  message: string;
  decision: PremiumDecision;
};

/**
 * How each feature is named: [name, one use, several uses, whether the name
 * takes "are"]. The same rows the edge functions refuse with
 * (supabase/functions/_shared/premium.ts, pinned by premium.test.ts). Stated
 * per feature because the last letter guessed it once: "Topic-wise analysis
 * are not in your plan."
 */
const FEATURE_WORDS: Record<PremiumFeature, [string, string, string, boolean]> = {
  "practice.question": ["Practice questions", "practice question", "practice questions", true],
  "analysis.topic": ["Topic-wise analysis", "topic-wise analysis", "topic-wise analysis", false],
  "nova.message": ["Nova AI tutor messages", "Nova message", "Nova messages", true],
  "mistake.explain": ["Explain my mistake", "Explain my mistake", "Explain my mistake", false],
  "insights.report": ["AI insights coach", "AI insights coach", "AI insights coach", false],
  "custom_practice.upload": ["Custom Practice uploads", "Custom Practice upload", "Custom Practice uploads", true],
  "screen_capture.mistake": ["Mistakes captured from other apps", "screen capture", "screen captures", true],
  "mock_test.start": ["Full CUET mock tests", "mock test", "mock tests", true],
};

export const FEATURE_NAMES = Object.fromEntries(
  Object.entries(FEATURE_WORDS).map(([f, [name]]) => [f, name]),
) as Record<PremiumFeature, string>;

/** The order the plans screen lists features in. */
export const FEATURE_ORDER: PremiumFeature[] = [
  "practice.question",
  "analysis.topic",
  "nova.message",
  "mistake.explain",
  "insights.report",
  "custom_practice.upload",
  "screen_capture.mistake",
  "mock_test.start",
];

/** "20 a day", "Unlimited", "5 a month", "1 in total", "Included". */
export function describeAllowance(period: PremiumPeriod | undefined, limit: number | null | undefined): string {
  if (period === "none") return "Included";
  if (limit == null) return "Unlimited";
  if (period === "day") return `${limit} a day`;
  if (period === "month") return `${limit} a month`;
  return `${limit} in total`;
}

const PERIOD_WORD: Record<string, string> = { day: "today's", month: "this month's", lifetime: "your" };

function messageFor(d: PremiumDecision): string {
  const [name, one, many, plural] = FEATURE_WORDS[d.feature as PremiumFeature] ?? [d.feature, d.feature, d.feature, false];
  if (d.reason === "limit_reached" && typeof d.limit === "number") {
    return `You've used ${PERIOD_WORD[d.period ?? ""] ?? "your"} ${d.limit} ${d.limit === 1 ? one : many}.`;
  }
  return `${name} ${plural ? "are" : "is"} not in your plan.`;
}

function asDecision(v: unknown): PremiumDecision | null {
  if (!v || typeof v !== "object") return null;
  const d = v as PremiumDecision;
  return typeof d.ok === "boolean" && typeof d.feature === "string" ? d : null;
}

function limitFromDecision(d: PremiumDecision | null): PlanLimit | null {
  if (!d || d.ok || (d.reason !== "not_in_plan" && d.reason !== "limit_reached")) return null;
  return { feature: d.feature, reason: d.reason, message: messageFor(d), decision: d };
}

/**
 * A refusal the server states as a flag on a read rather than as a decision —
 * `topic_analysis_locked` on the snapshot and the practice analytics.
 */
export function notInPlan(feature: PremiumFeature): PlanLimit {
  const d: PremiumDecision = { ok: false, feature, reason: "not_in_plan" };
  return { feature, reason: "not_in_plan", message: messageFor(d), decision: d };
}

/**
 * The plan refusal in whatever an edge function, the gateway or an RPC
 * returned — or null when it is not one.
 */
export function planLimitFrom(value: unknown): PlanLimit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // Edge function body, or the gateway's envelope.
  if (v.error_code === "plan_limit" || v.decision === "plan_limit") {
    return limitFromDecision(asDecision(v.premium));
  }
  // A PostgREST error from a database gate: message "plan_limit:<feature>",
  // the decision in details.
  if (typeof v.message === "string" && v.message.startsWith("plan_limit:")) {
    let d: PremiumDecision | null = null;
    if (typeof v.details === "string") {
      try {
        d = asDecision(JSON.parse(v.details));
      } catch {
        d = null;
      }
    }
    const feature = v.message.slice("plan_limit:".length);
    return limitFromDecision(d) ?? {
      feature,
      reason: v.hint === "not_in_plan" ? "not_in_plan" : "limit_reached",
      message: messageFor({ ok: false, feature, reason: v.hint === "not_in_plan" ? "not_in_plan" : "limit_reached" }),
      decision: { ok: false, feature },
    };
  }
  return null;
}

/** A plan refusal thrown by a service call, so a screen can show the notice. */
export class PlanLimitError extends Error {
  constructor(readonly planLimit: PlanLimit) {
    super(planLimit.message);
    this.name = "PlanLimitError";
  }
}

/**
 * Practice modes the server never counts against the daily allowance —
 * rpc_record_question_attempt's `_practice_mode NOT IN (...)` in
 * 20261111000000, pinned to that SQL by premium.test.ts. The screen only
 * uses this to size a session; the server is what refuses.
 */
export const PRACTICE_MODES_NOT_COUNTED = ["recovery", "revision", "incorrect"] as const;

/**
 * Whether a practice session's answers count as new practice questions.
 * Uploaded questions go in with source 'upload' (their own limit), and a
 * Recovery session or Revision check is free whatever its mode says.
 */
export function practiceSessionIsCounted(s: { mode: string; recovery?: unknown; revision?: unknown; upload?: unknown }): boolean {
  if (s.upload || s.recovery || s.revision) return false;
  return !(PRACTICE_MODES_NOT_COUNTED as readonly string[]).includes(s.mode);
}

/** The refusal carried by a failed `supabase.functions.invoke`, if it is one. */
export async function planLimitFromInvokeError(error: unknown): Promise<PlanLimit | null> {
  const failure = await readEdgeFunctionError(error);
  return failure.errorCode === "plan_limit" ? planLimitFrom(failure.body) : null;
}

export async function fetchPremiumStatus(): Promise<PremiumStatus> {
  const { data, error } = await supabase.rpc("rpc_my_premium");
  if (error) throw new Error(error.message);
  return data as unknown as PremiumStatus;
}

/** A feature's decision for the caller, from a status already read. */
export function featureDecision(status: PremiumStatus | null, feature: PremiumFeature): PremiumDecision | null {
  if (!status || !status.individual) return null;
  return status.features.find((f) => f.feature === feature) ?? null;
}

/**
 * The notice for a feature the plan refuses now, from a status already read —
 * null while it is allowed, while plans are not enforced, or for a school's
 * student. A screen checks this before work the server would refuse.
 */
export function refusalFor(status: PremiumStatus | null, feature: PremiumFeature): PlanLimit | null {
  return limitFromDecision(featureDecision(status, feature));
}

const LEFT_WHEN: Record<string, string> = { day: " today", month: " this month" };

/**
 * The uses of a counted feature left under a plan in force, and the sentence
 * that says so — null when nothing limits it (unlimited, or not enforced).
 */
export function usesLeft(status: PremiumStatus | null, feature: PremiumFeature): { left: number; note: string } | null {
  const d = featureDecision(status, feature);
  if (!d?.enforced || !d.ok || typeof d.remaining !== "number") return null;
  const [, one, many] = FEATURE_WORDS[feature];
  return { left: d.remaining, note: `${d.remaining} ${d.remaining === 1 ? one : many} left${LEFT_WHEN[d.period ?? ""] ?? ""} on your plan.` };
}

/**
 * True when the feature would be refused now. While enforcement is off
 * nothing is refused, whatever the plan.
 */
export function isRefused(status: PremiumStatus | null, feature: PremiumFeature): boolean {
  const d = featureDecision(status, feature);
  return !!d && d.ok === false;
}

/** Buying happens on the web only (see the header). */
export function canBuyInThisApp(): boolean {
  return !Capacitor.isNativePlatform();
}

export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees.toLocaleString("en-IN") : rupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

// ── Buying ──────────────────────────────────────────────────────────────────

export type PremiumOrder = {
  order_id: string;
  product: string;
  tier: string;
  amount_paise: number;
  currency: string;
  validity_days: number;
  status: "created" | "paid" | "refunded";
  created_at: string;
  paid_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  payment_method: string | null;
  refunded_paise: number;
  terms_version: string;
  starts_at: string | null;
  ends_at: string | null;
  credit_seconds: number | null;
  revoked_at: string | null;
  revoke_reason: string | null;
};

export async function fetchMyOrders(): Promise<PremiumOrder[]> {
  const { data, error } = await supabase.rpc("rpc_my_premium_orders");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as unknown as PremiumOrder[];
}

type VerifyResult = { ok: boolean; status: "paid" | "pending" | "unpaid" | "refunded" | "needs_review"; error?: string; tier?: string; ends_at?: string };

async function invokeJson<T>(name: string, body: Record<string, unknown>): Promise<{ data: T | null; error: string | null; code: string | null }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const f = await readEdgeFunctionError(error);
    return { data: null, error: f.message ?? "Something went wrong. Please try again.", code: f.errorCode };
  }
  return { data: data as T, error: null, code: null };
}

/** Ask the server to finish an order (after Checkout, or when coming back). */
export async function verifyOrder(input: {
  razorpay_order_id: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
}): Promise<VerifyResult> {
  const r = await invokeJson<VerifyResult>("premium-verify", input);
  if (r.data) return r.data;
  return { ok: false, status: r.code === "bad_signature" ? "unpaid" : "pending", error: r.error ?? undefined };
}

type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: string, cb: (r: unknown) => void): void };
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

let checkoutScript: Promise<RazorpayCtor> | null = null;

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  if (!checkoutScript) {
    checkoutScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.async = true;
      s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay did not load")));
      s.onerror = () => {
        checkoutScript = null;
        reject(new Error("Could not reach the payment page. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
  }
  return checkoutScript;
}

export type CheckoutOutcome =
  | { kind: "paid"; tier?: string; ends_at?: string }
  | { kind: "pending"; razorpay_order_id: string }
  | { kind: "cancelled"; razorpay_order_id: string }
  | { kind: "failed"; message: string; razorpay_order_id?: string };

/**
 * Buy a product: make the order on the server, pay in Razorpay Checkout, and
 * have the server confirm it from Razorpay before the plan appears.
 */
export async function buyPlan(input: {
  product_code: string;
  terms_version: string;
  guardian_confirmed: boolean;
  prefill?: { name?: string; contact?: string };
}): Promise<CheckoutOutcome> {
  if (!canBuyInThisApp()) return { kind: "failed", message: "Plans can't be bought in this app." };

  const begun = await invokeJson<{
    ok: boolean; order_id: string; razorpay_order_id: string; key_id: string; amount_paise: number;
    currency: string; display_name: string;
  }>("premium-checkout", {
    product_code: input.product_code,
    terms_version: input.terms_version,
    guardian_confirmed: input.guardian_confirmed,
  });
  if (!begun.data?.ok) return { kind: "failed", message: begun.error ?? "Could not start the payment." };
  const order = begun.data;

  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await loadCheckout();
  } catch (e) {
    return { kind: "failed", message: toErrorMessage(e, "Could not open the payment page."), razorpay_order_id: order.razorpay_order_id };
  }

  const paid = await new Promise<RazorpaySuccess | "cancelled" | { failed: string }>((resolve) => {
    const rz = new Razorpay({
      key: order.key_id,
      order_id: order.razorpay_order_id,
      amount: order.amount_paise,
      currency: order.currency,
      name: "Gurukul",
      description: order.display_name,
      prefill: input.prefill ?? {},
      notes: { order_id: order.order_id },
      theme: { color: "#7c3aed" },
      handler: (r: RazorpaySuccess) => resolve(r),
      modal: { ondismiss: () => resolve("cancelled"), confirm_close: true },
    });
    rz.on("payment.failed", (r: unknown) => {
      const desc = (r as { error?: { description?: string } })?.error?.description;
      resolve({ failed: desc || "The payment did not go through." });
    });
    rz.open();
  });

  if (paid === "cancelled") {
    // A payment can still have gone through (UPI approved after the window
    // closed): ask once before calling it cancelled.
    const v = await verifyOrder({ razorpay_order_id: order.razorpay_order_id });
    if (v.status === "paid") return { kind: "paid", tier: v.tier, ends_at: v.ends_at };
    if (v.status === "pending") return { kind: "pending", razorpay_order_id: order.razorpay_order_id };
    return { kind: "cancelled", razorpay_order_id: order.razorpay_order_id };
  }
  if ("failed" in paid) return { kind: "failed", message: paid.failed, razorpay_order_id: order.razorpay_order_id };

  const v = await verifyOrder(paid);
  if (v.status === "paid") return { kind: "paid", tier: v.tier, ends_at: v.ends_at };
  if (v.status === "needs_review") return { kind: "failed", message: v.error ?? "Your payment needs a check by our team." };
  return { kind: "pending", razorpay_order_id: order.razorpay_order_id };
}
