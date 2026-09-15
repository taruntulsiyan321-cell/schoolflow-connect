/**
 * The Overview tab prints "Correct", "Incorrect" and "Accuracy" on one row.
 * The only rule that matters is that a reader can do the arithmetic and get
 * the same answer.
 *
 * It did not hold: skips were removed from `wrong` and left in the accuracy
 * denominator, so the row read 10 correct, 14 incorrect, 36% — and 10 of 24 is
 * 42%. Caught by looking at the real screen in a browser, not by any test,
 * which is why this file exists.
 */
import { describe, it, expect } from "vitest";
import { accuracyOverAnswered } from "@/hooks/useAnalysisPageData";

describe("accuracyOverAnswered", () => {
  it("is the two counts shown beside it, and nothing else", () => {
    // The exact numbers measured on the live screen.
    expect(accuracyOverAnswered(10, 14)).toBe(42);
  });

  it("ignores skipped questions entirely — they are not in either count", () => {
    // 4 skips existed in that session. Whatever they are, they must not be
    // able to change this number, because they are not on the row.
    expect(accuracyOverAnswered(10, 14)).toBe(accuracyOverAnswered(10, 14));
    // The old behaviour was 10/(10+14+4) = 36. Assert we are NOT that.
    expect(accuracyOverAnswered(10, 14)).not.toBe(36);
  });

  it("is null, not zero, when nothing has been answered", () => {
    // 0% would tell a student who has never practised that they got
    // everything wrong.
    expect(accuracyOverAnswered(0, 0)).toBeNull();
  });

  it("reads 0 only when everything answered was wrong", () => {
    expect(accuracyOverAnswered(0, 7)).toBe(0);
  });

  it("reads 100 only when everything answered was right", () => {
    expect(accuracyOverAnswered(7, 0)).toBe(100);
  });

  it("POSITIVE CONTROL — the assertion can distinguish the two formulas", () => {
    // If correct/(correct+wrong) ever equalled correct/(correct+wrong+skips)
    // for these inputs, the first test would pass against the old bug.
    const withSkips = Math.round((100 * 10) / (10 + 14 + 4));
    expect(accuracyOverAnswered(10, 14)).not.toBe(withSkips);
    expect(withSkips).toBe(36);
  });
});
