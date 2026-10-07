/**
 * The one place the app recognises a plan refusal (src/lib/premium.ts).
 * Every shape a door sends must be read, and nothing else may be mistaken
 * for one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { describeAllowance, formatRupees, planLimitFrom } = await import("./premium");

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

describe("which practice the allowance counts", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { PRACTICE_MODES_NOT_COUNTED, practiceSessionIsCounted } = await import("./premium");

  it("names exactly the modes the server's gate exempts (pinned to 20261111000000)", () => {
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261111000000_premium_plans_for_individual_accounts.sql"), "utf8");
    const gate = sql.match(/IF _src = 'practice' AND COALESCE\(_practice_mode, ''\) NOT IN \(([^)]*)\) THEN\s+PERFORM public\._premium_require\(_uid, 'practice\.question', 1\);/);
    expect(gate, "the gate's SQL moved: re-pin this list to it").not.toBeNull();
    const server = gate![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect([...PRACTICE_MODES_NOT_COUNTED].sort()).toEqual(server);
  });

  it("counts new practice, and never Recovery, Revision, reattempts or uploads", () => {
    for (const mode of ["subject", "chapter", "topic", "custom", "pyq", "weak", "skipped", "bookmarked"]) {
      expect(practiceSessionIsCounted({ mode }), mode).toBe(true);
    }
    expect(practiceSessionIsCounted({ mode: "incorrect" })).toBe(false);
    expect(practiceSessionIsCounted({ mode: "recovery" })).toBe(false);
    expect(practiceSessionIsCounted({ mode: "chapter", revision: { chapterId: "c" } })).toBe(false);
    expect(practiceSessionIsCounted({ mode: "custom", recovery: { sessionId: "s" } })).toBe(false);
    expect(practiceSessionIsCounted({ mode: "custom", upload: { uploadId: "u" } })).toBe(false);
  });
});

describe("the refusal sentences", () => {
  it("say 'is' or 'are' by the word, not its last letter", async () => {
    const { notInPlan } = await import("./premium");
    // "Topic-wise analysis are not in your plan." — the last letter decided it.
    expect(notInPlan("analysis.topic").message).toBe("Topic-wise analysis is not in your plan.");
    expect(notInPlan("mock_test.start").message).toBe("Full CUET mock tests are not in your plan.");
  });

  it("are the ones the edge functions send (supabase/functions/_shared/premium.ts)", async () => {
    // The server's own planLimitMessage, run — not its source read. It is
    // Deno code, so it is transpiled here with its one import removed (the
    // function never touches it).
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ts = (await import("typescript")).default;
    const src = readFileSync(join(__dirname, "../../supabase/functions/_shared/premium.ts"), "utf8")
      .replace(/^import .*esm.sh.*$/m, "");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const server = {} as { planLimitMessage: (d: unknown) => string };
    new Function("exports", "require", js)(server, () => ({}));

    const { FEATURE_ORDER, notInPlan } = await import("./premium");
    for (const f of FEATURE_ORDER) {
      expect(server.planLimitMessage({ ok: false, feature: f, reason: "not_in_plan" })).toBe(notInPlan(f).message);
      for (const [period, limit] of [["day", 1], ["month", 5], ["lifetime", 1]] as const) {
        const d = { ok: false, feature: f, reason: "limit_reached", limit, period };
        expect(server.planLimitMessage(d)).toBe(planLimitFrom({ error_code: "plan_limit", premium: d })?.message);
      }
    }
    // CONTROL: the comparison is not vacuous.
    expect(server.planLimitMessage({ ok: false, feature: "analysis.topic", reason: "not_in_plan" })).toBe("Topic-wise analysis is not in your plan.");
  });
});
