import { describe, expect, it } from "vitest";
import { improveHeadline, improveSubline } from "./analysisImproveCard";

describe("What should I improve?", () => {
  it("lists three weak subjects as a list, not a stammer", () => {
    expect(improveHeadline(["Accountancy", "Economics", "Business Studies"], true)).toBe("Accountancy, Economics & Business Studies");
    expect(improveHeadline(["Accountancy", "Economics"], true)).toBe("Accountancy & Economics");
  });

  it("does not deny weak topics under weak subjects", () => {
    expect(improveSubline(0, 3)).toBe("No single topic stands out yet");
  });

  it("CONTROL: with nothing weak at all, says so", () => {
    expect(improveHeadline([], true)).toBe("Keep building consistency");
    expect(improveSubline(0, 0)).toBe("No weak topics flagged yet");
  });

  it("agrees the verb with the count", () => {
    expect(improveSubline(1, 1)).toBe("1 topic needs attention");
    expect(improveSubline(2, 1)).toBe("2 topics need attention");
  });
});
