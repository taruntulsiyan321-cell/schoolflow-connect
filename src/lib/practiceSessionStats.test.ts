import { describe, expect, it } from "vitest";
import {
  deriveSessionAccuracy,
  formatSessionAccuracy,
  formatSessionDuration,
  formatSessionXp,
  resolvePracticeSessionStats,
} from "./practiceSessionStats";

describe("practiceSessionStats", () => {
  it("reads a finished row as the answer, and never invents XP", () => {
    const stats = resolvePracticeSessionStats({
      question_count: 10,
      correct_count: 7,
      wrong_count: 2,
      skipped_count: 1,
      accuracy: 77.78,
      xp_earned: 60,
      finished_at: "2026-08-02T12:00:00Z",
    });
    expect(stats.accuracy).toBe(78);
    expect(stats.xpEarned).toBe(60);
    expect(stats.xpFromDb).toBe(true);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("60");
  });

  it("derives accuracy over ANSWERED questions — a skip is not a wrong answer", () => {
    // 3 correct, 1 wrong, 1 skipped: 3 of 4 answered. The old helper said 60
    // (3 of 5), while the finish RPC stored 75 — two numbers for one sitting.
    expect(deriveSessionAccuracy(3, 1)).toBe(75);
    const stats = resolvePracticeSessionStats({ question_count: 5, correct_count: 3, skipped_count: 1 });
    expect(stats.wrongCount).toBe(1);
    expect(stats.accuracy).toBe(75);
    expect(stats.xpFromDb).toBe(false);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("—");
  });

  it("has no accuracy when nothing was answered, and says so", () => {
    expect(deriveSessionAccuracy(0, 0)).toBeNull();
    // Finished, every question skipped: the finish stored accuracy NULL.
    const stats = resolvePracticeSessionStats({
      question_count: 8, correct_count: 0, wrong_count: 0, skipped_count: 8,
      accuracy: null, xp_earned: 25, finished_at: "2026-09-17T14:30:47Z",
    });
    expect(stats.accuracy).toBeNull();
    expect(formatSessionAccuracy(stats.accuracy)).toBe("—");
    // Control: a real zero is still a zero.
    const allWrong = resolvePracticeSessionStats({
      question_count: 4, correct_count: 0, wrong_count: 4, skipped_count: 0,
      accuracy: 0, xp_earned: 25, finished_at: "2026-09-17T14:30:47Z",
    });
    expect(formatSessionAccuracy(allWrong.accuracy)).toBe("0%");
  });

  it("does not treat the column default on an open row as credited XP", () => {
    const stats = resolvePracticeSessionStats({ question_count: 5, correct_count: 2, xp_earned: 0, finished_at: null });
    expect(stats.xpFromDb).toBe(false);
    expect(formatSessionXp(0, false)).toBe("—");
  });

  it("shows a finished session's 0 XP as 0", () => {
    const stats = resolvePracticeSessionStats({
      question_count: 1, correct_count: 0, xp_earned: 0, finished_at: "2026-08-02T12:00:00Z",
    });
    expect(stats.xpFromDb).toBe(true);
    expect(formatSessionXp(stats.xpEarned, stats.xpFromDb)).toBe("0");
  });

  it("prefers a finished row over the finish reply it came from", () => {
    // The row can be corrected after the reply was taken (a repair migration).
    const stats = resolvePracticeSessionStats(
      { question_count: 10, correct_count: 5, wrong_count: 5, accuracy: 50, xp_earned: 40, finished_at: "2026-09-17T10:00:00Z" },
      { questionCount: 11, correctCount: 5, accuracy: 45, xpEarned: 40 },
    );
    expect(stats.questionCount).toBe(10);
    expect(stats.accuracy).toBe(50);
  });

  it("reads the finish reply, whole, before the row has loaded", () => {
    const stats = resolvePracticeSessionStats(null, {
      questionCount: 8, correctCount: 6, wrongCount: 1, skippedCount: 1, accuracy: 85.71, xpEarned: 55,
    });
    expect(stats).toMatchObject({ questionCount: 8, correctCount: 6, accuracy: 86, xpEarned: 55, xpFromDb: true });
  });

  it("formats a duration from the questions' time, never inventing a minute", () => {
    expect(formatSessionDuration(7000)).toBe("7s");
    expect(formatSessionDuration(125000)).toBe("2m");
    expect(formatSessionDuration(3900000)).toBe("1h 5m");
    expect(formatSessionDuration(null)).toBe("—");
    expect(formatSessionDuration(0)).toBe("—");
  });
});
