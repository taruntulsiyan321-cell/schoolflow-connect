import { describe, expect, it } from "vitest";
import { accuracyFromXp } from "./battlegroundHelpers";

/**
 * Ruling 8: no zeroes for absent data — an em dash instead.
 *
 * `accuracyFromXp` used to return 0 when `total_answered` was 0, and the
 * Battleground leaderboard printed "0%" beside every student who had never
 * played a battle. That is a mark, not an absence, and it is the same defect
 * `academic/metrics/practice.ts` exists to prevent for practice sessions.
 *
 * Nothing asserted the old behaviour, so nothing would have caught the change
 * either way. These four do.
 */
describe("accuracyFromXp — ruling 8", () => {
  it("is null when nothing was answered, not 0", () => {
    expect(accuracyFromXp({ total_correct: 0, total_answered: 0 })).toBeNull();
  });

  it("is null when the student has no xp row at all", () => {
    expect(accuracyFromXp({})).toBeNull();
  });

  it("still computes an accuracy when there IS something to compute from (positive control)", () => {
    // Without this, returning null unconditionally would satisfy both tests above.
    expect(accuracyFromXp({ total_correct: 3, total_answered: 4 })).toBe(75);
  });

  it("returns a real 0 when the student answered and got none right", () => {
    // The one case where 0 is the truth rather than the absence of one.
    expect(accuracyFromXp({ total_correct: 0, total_answered: 5 })).toBe(0);
  });
});
