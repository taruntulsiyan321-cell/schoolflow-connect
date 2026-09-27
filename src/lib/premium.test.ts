/**
 * The one place the app recognises a plan refusal (src/lib/premium.ts).
 * Every shape a door sends must be read, and nothing else may be mistaken
 * for one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { describeAllowance, formatRupees, planLimitFrom, isRefused } = await import("./premium");

const decision = {
  ok: false,
  applies: true,
  enforced: true,
  tier: "free",
  feature: "nova.message",
  period: "day",
  period_key: "d:2026-09-27",
  limit: 5,
  used: 5,
  remaining: 0,
  reason: "limit_reached",
};

describe("planLimitFrom", () => {
  it("reads an edge function's 402 body", () => {
    const p = planLimitFrom({ error: "…", error_code: "plan_limit", premium: decision });
    expect(p).toMatchObject({ feature: "nova.message", reason: "limit_reached" });
    expect(p?.message).toBe("You've used today's 5 Nova messages.");
  });

  it("reads the Nova gateway's envelope", () => {
    const p = planLimitFrom({ decision: "plan_limit", feature_id: "student.nova.chat", premium: { ...decision, feature: "mistake.explain", reason: "not_in_plan", limit: null, period: undefined } });
    expect(p).toMatchObject({ feature: "mistake.explain", reason: "not_in_plan" });
    expect(p?.message).toBe("Explain my mistake is not in your plan.");
  });

  it("reads a database gate's PostgREST error", () => {
    const err = {
      code: "P0001",
      message: "plan_limit:practice.question",
      details: JSON.stringify({ ...decision, feature: "practice.question", limit: 20, used: 20 }),
      hint: "limit_reached",
    };
    const p = planLimitFrom(err);
    expect(p).toMatchObject({ feature: "practice.question", reason: "limit_reached" });
    expect(p?.message).toBe("You've used today's 20 practice questions.");
  });

  it("still recognises a database refusal whose details are unreadable", () => {
    expect(planLimitFrom({ message: "plan_limit:analysis.topic", details: "not json", hint: "not_in_plan" }))
      .toMatchObject({ feature: "analysis.topic", reason: "not_in_plan" });
  });

  it("CONTROL: is not fooled by other errors or by an allowed decision", () => {
    expect(planLimitFrom(null)).toBeNull();
    expect(planLimitFrom("plan_limit")).toBeNull();
    expect(planLimitFrom({ error: "Not authenticated", error_code: "unauthenticated" })).toBeNull();
    expect(planLimitFrom({ decision: "degraded", message: "402 credits" })).toBeNull();
    expect(planLimitFrom({ message: "permission denied for function rpc_x", code: "42501" })).toBeNull();
    expect(planLimitFrom({ error_code: "plan_limit", premium: { ...decision, ok: true } })).toBeNull();
  });
});

describe("isRefused", () => {
  const status = {
    individual: true as const,
    enforced: true,
    sales_enabled: false,
    terms_version: "",
    tier: "free",
    tier_rank: 0,
    tier_until: null,
    entitlements: [],
    tiers: [],
    products: [],
    features: [
      { ok: false, feature: "analysis.topic", reason: "not_in_plan" as const },
      { ok: true, feature: "practice.question", period: "day" as const, limit: 20, used: 3, remaining: 17 },
    ],
  };
  it("follows the server's decision per feature", () => {
    expect(isRefused(status, "analysis.topic")).toBe(true);
    expect(isRefused(status, "practice.question")).toBe(false);
  });
  it("never refuses a school student or an unread status", () => {
    expect(isRefused({ individual: false }, "analysis.topic")).toBe(false);
    expect(isRefused(null, "analysis.topic")).toBe(false);
  });
});

describe("describeAllowance and formatRupees", () => {
  it("says what a plan gives", () => {
    expect(describeAllowance("day", 20)).toBe("20 a day");
    expect(describeAllowance("month", 5)).toBe("5 a month");
    expect(describeAllowance("lifetime", 1)).toBe("1 in total");
    expect(describeAllowance("day", null)).toBe("Unlimited");
    expect(describeAllowance("none", null)).toBe("Included");
  });
  it("prints paise as rupees", () => {
    expect(formatRupees(19900)).toBe("₹199");
    expect(formatRupees(99900)).toBe("₹999");
    expect(formatRupees(19950)).toBe("₹199.50");
  });
});
