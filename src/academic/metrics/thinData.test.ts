import { describe, it, expect } from "vitest";
import {
  MIN_OBSERVATIONS_FOR_VERDICT,
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
    expect(accuracyWhenMeaningful(MIN_OBSERVATIONS_FOR_VERDICT - 1, 60)).toBeNull();
    expect(accuracyWhenMeaningful(MIN_OBSERVATIONS_FOR_VERDICT, 60)).toBe(60);
    expect(accuracyWhenMeaningful(MIN_OBSERVATIONS_FOR_VERDICT + 40, 60)).toBe(60);
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
    expect(mayBeJudged(MIN_OBSERVATIONS_FOR_VERDICT - 1)).toBe(false);
    expect(mayBeJudged(MIN_OBSERVATIONS_FOR_VERDICT)).toBe(true);
  });

  it("survives rubbish counts without reporting anything", () => {
    expect(accuracyWhenMeaningful(Number.NaN, 90)).toBeNull();
    expect(mayBeJudged(Number.NaN)).toBe(false);
  });

  it("keeps the threshold a named constant, not a literal on a screen", () => {
    expect(Number.isInteger(MIN_OBSERVATIONS_FOR_VERDICT)).toBe(true);
    expect(MIN_OBSERVATIONS_FOR_VERDICT).toBeGreaterThan(1);
  });
});

/**
 * THE REGRESSION THAT MOTIVATED THE RENAME.
 *
 * Every one of the cases above passes a number, and both helpers took a
 * number, so the type system had nothing to say when a caller passed the
 * ATTEMPT count instead of the answers the rate is computed from. These pin
 * the arithmetic of the four rows that were measured rendering a verdict they
 * had not earned, so the defect cannot come back silently.
 */
describe("skips are not evidence (\u00a76.6)", () => {
  // subject/chapter rows as production returned them on 2026-09-19, for
  // student d1000003-0001. `attempts` clears the floor in every case; the
  // answers behind the rate do not.
  const measured = [
    { row: "Circles",                            attempts: 8, skipped: 7, accuracy: 0 },
    { row: "Statistics",                         attempts: 8, skipped: 5, accuracy: 33.3 },
    { row: "Triangles",                          attempts: 9, skipped: 7, accuracy: 50 },
    { row: "Some Applications of Trigonometry",  attempts: 6, skipped: 4, accuracy: 50 },
    { row: "Areas of Similar Triangles",         attempts: 5, skipped: 4, accuracy: 0 },
    { row: "Reporting Imperative Sentences",     attempts: 5, skipped: 5, accuracy: null },
  ];

  it.each(measured)(
    "$row: $attempts attempts clear the floor, its answers do not",
    ({ attempts, skipped, accuracy }) => {
      const answered = attempts - skipped;
      // POSITIVE CONTROL. If this line ever fails, the fixture stopped being
      // the case under test and the assertions below prove nothing.
      expect(mayBeJudged(attempts)).toBe(true);

      expect(mayBeJudged(answered)).toBe(false);
      expect(accuracyWhenMeaningful(answered, accuracy)).toBeNull();
    },
  );

  it("still reports a chapter whose answers clear the floor", () => {
    // Pair of Linear Equations in Two Variables: 14 attempts, 3 skipped.
    // The fix must not silence rows that were always legitimate.
    expect(accuracyWhenMeaningful(14 - 3, 54.5)).toBe(54.5);
    // Real Numbers: 44 attempts, 19 skipped, a genuine 8%.
    expect(accuracyWhenMeaningful(44 - 19, 8)).toBe(8);
  });

  it("separates the time denominator from the answer denominator", () => {
    // Reporting Imperative Sentences: 5 timed readings, 0 answers. It has
    // enough evidence to be RANKED by time and none to be judged on accuracy.
    expect(mayBeJudged(5)).toBe(true);
    expect(accuracyWhenMeaningful(0, null)).toBeNull();
    // The 579-second topic: one attempt, one timed reading. Neither.
    expect(mayBeJudged(1)).toBe(false);
  });
});
