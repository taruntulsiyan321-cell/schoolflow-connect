import { describe, expect, it } from "vitest";
import {
  deriveSessionAccuracy,
  formatSessionXp,
  resolvePracticeSessionStats,
} from "./practiceSessionStats";

describe("practiceSessionStats SSOT", () => {
  it("prefers DB accuracy and never invents XP", () => {
    const stats = resolvePracticeSessionStats({
      question_count: 10,
      correct_count: 7,
      wrong_count: 2,
      skipped_count: 1,
      accuracy: 70,
      xp_earned: 60,
    });
    expect(stats.accuracy).toBe(70);
    expect(stats.accuracyFromDb).toBe(true);
    expect(stats.xpEarned).toBe(60);
    expect(stats.xpFromDb).toBe(true);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("60");
  });

  it("derives accuracy with skips in denominator; XP stays 0 without DB", () => {
    expect(deriveSessionAccuracy(3, 5)).toBe(60);
    const stats = resolvePracticeSessionStats({
      question_count: 5,
      correct_count: 3,
      skipped_count: 1,
    });
    expect(stats.accuracy).toBe(60);
    expect(stats.wrongCount).toBe(1);
    expect(stats.xpEarned).toBe(0);
    expect(stats.xpFromDb).toBe(false);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("—");
  });

  it("snapshot overlay wins for saved-session reopen", () => {
    const stats = resolvePracticeSessionStats(
      { question_count: 10, correct_count: 5, accuracy: 50, xp_earned: 40 },
      { questionCount: 8, correctCount: 6, accuracy: 75, xpEarned: 55 },
    );
    expect(stats.questionCount).toBe(8);
    expect(stats.correctCount).toBe(6);
    expect(stats.accuracy).toBe(75);
    expect(stats.xpEarned).toBe(55);
  });
});
