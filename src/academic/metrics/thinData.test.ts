import { describe, it, expect } from "vitest";
import {
  MIN_ATTEMPTS_FOR_ACCURACY,
  accuracyWhenMeaningful,
  mayBeJudged,
} from "./thresholds";

/**
 * G7 — thin data never becomes a judgement.
 *
 * The case that matters is one attempt: 62% of topic groups hold exactly one
 * question, so a single wrong answer would otherwise render "0% accuracy" and
 * label the student weak at that topic.
 */
describe("thin data", () => {
  it("refuses accuracy on a single attempt, however emphatic the number", () => {
    expect(accuracyWhenMeaningful(1, 0)).toBeNull();
    expect(accuracyWhenMeaningful(1, 100)).toBeNull();
  });

  it("refuses right up to the threshold and reports at it", () => {
    expect(accuracyWhenMeaningful(MIN_ATTEMPTS_FOR_ACCURACY - 1, 60)).toBeNull();
    expect(accuracyWhenMeaningful(MIN_ATTEMPTS_FOR_ACCURACY, 60)).toBe(60);
    expect(accuracyWhenMeaningful(MIN_ATTEMPTS_FOR_ACCURACY + 40, 60)).toBe(60);
  });

  it("returns null, never 0, when there is no figure at all", () => {
    // The existing null contract: missing renders an em dash, never a zero.
    expect(accuracyWhenMeaningful(50, null)).toBeNull();
    expect(accuracyWhenMeaningful(50, undefined)).toBeNull();
    expect(accuracyWhenMeaningful(50, Number.NaN)).toBeNull();
  });

  it("keeps a real 0% once there is enough behind it", () => {
    // 0 of 20 is a measurement, not thin data, and must not be swallowed.
    expect(accuracyWhenMeaningful(20, 0)).toBe(0);
  });

  it("gates weak/strong labels on the same count", () => {
    expect(mayBeJudged(1)).toBe(false);
    expect(mayBeJudged(MIN_ATTEMPTS_FOR_ACCURACY - 1)).toBe(false);
    expect(mayBeJudged(MIN_ATTEMPTS_FOR_ACCURACY)).toBe(true);
  });

  it("survives rubbish counts without reporting anything", () => {
    expect(accuracyWhenMeaningful(Number.NaN, 90)).toBeNull();
    expect(mayBeJudged(Number.NaN)).toBe(false);
  });

  it("keeps the threshold a named constant, not a literal on a screen", () => {
    expect(Number.isInteger(MIN_ATTEMPTS_FOR_ACCURACY)).toBe(true);
    expect(MIN_ATTEMPTS_FOR_ACCURACY).toBeGreaterThan(1);
  });
});
