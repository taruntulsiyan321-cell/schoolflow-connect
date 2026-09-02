import { describe, expect, it } from "vitest";

import { decisionAttribution, type LeaveDecisionRow } from "./leaveService";

const decision = (over: Partial<LeaveDecisionRow> = {}): LeaveDecisionRow => ({
  leaveRequestId: "r1",
  decision: "approved",
  decidedBy: null,
  decidedByRole: null,
  decidedAt: null,
  reason: null,
  ...over,
});

describe("decisionAttribution", () => {
  // The wording rule: say what the data supports. A verdict is always shown by
  // the status badge; this line only ever describes WHO, and never invents one.
  it("says nothing when there is no decision at all", () => {
    expect(decisionAttribution(undefined)).toBeNull();
  });

  it("names the decider as not recorded rather than attributing it to anyone", () => {
    const line = decisionAttribution(decision());
    expect(line).toBe("decider not recorded");
    // The guard that matters: no fallback ever substitutes another actor.
    expect(line).not.toMatch(/principal|teacher|admin|system/i);
  });

  it("still says not recorded when a role is present but no decider is", () => {
    expect(decisionAttribution(decision({ decidedByRole: "principal" }))).toBe(
      "decider not recorded",
    );
  });

  it("names the role when a decider was actually recorded", () => {
    expect(
      decisionAttribution(decision({ decidedBy: "u1", decidedByRole: "principal" })),
    ).toBe("decided by principal");
  });

  it("reports a bare decision when the decider is known but the role is not", () => {
    expect(decisionAttribution(decision({ decidedBy: "u1" }))).toBe("decided");
  });

  it("is independent of the verdict — a rejection with no decider reads the same", () => {
    expect(decisionAttribution(decision({ decision: "rejected" }))).toBe(
      "decider not recorded",
    );
  });
});
