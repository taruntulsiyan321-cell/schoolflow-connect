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
      finished_at: "2026-08-02T12:00:00Z",
    });
    expect(stats.accuracy).toBe(70);
    expect(stats.xpEarned).toBe(60);
    expect(stats.xpFromDb).toBe(true);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("60");
  });

  it("derives accuracy; XP stays uncredited without finish", () => {
    expect(deriveSessionAccuracy(3, 5)).toBe(60);
    const stats = resolvePracticeSessionStats({
      question_count: 5,
      correct_count: 3,
      skipped_count: 1,
    });
    expect(stats.accuracy).toBe(60);
    expect(stats.xpFromDb).toBe(false);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("—");
  });

  it("DEFAULT xp_earned 0 unfinished is not credited", () => {
    const stats = resolvePracticeSessionStats({
      question_count: 5,
      correct_count: 2,
      xp_earned: 0,
      finished_at: null,
    });
    expect(stats.xpFromDb).toBe(false);
    expect(formatSessionXp(0, false)).toBe("—");
  });

  it("finished session may show 0 XP", () => {
    const stats = resolvePracticeSessionStats({
      question_count: 1,
      correct_count: 0,
      xp_earned: 0,
      finished_at: "2026-08-02T12:00:00Z",
    });
    expect(stats.xpFromDb).toBe(true);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("0");
  });

  it("snapshot overlay wins", () => {
    const stats = resolvePracticeSessionStats(
      { question_count: 10, correct_count: 5, accuracy: 50, xp_earned: 40 },
      { questionCount: 8, correctCount: 6, accuracy: 75, xpEarned: 55 },
    );
    expect(stats.xpEarned).toBe(55);
    expect(stats.xpFromDb).toBe(true);
  });
});
