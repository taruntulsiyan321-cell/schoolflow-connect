/**
 * A saved session is the finished row plus the answers that were recorded —
 * not whatever the screen that pressed Save happened to be holding.
 *
 * Measured on production, 2026-09-17: the two Save buttons saved two different
 * records of the same session. The result page froze the questions and the type
 * label "Practice"; the hub's "Save latest result" froze no questions at all,
 * so reopening a session saved from the hub had nothing to review.
 */
import { describe, expect, it } from "vitest";
import {
  buildPracticeAnalysisSnapshot,
  type PracticeAttemptRecord,
  type PracticeSessionRecord,
} from "./practiceAnalysisSnapshot";

const session: PracticeSessionRecord = {
  subject: "Mathematics",
  chapter: "Arithmetic Progressions",
  practice_mode: "chapter",
  difficulty: "easy",
  question_count: 3,
  correct_count: 1,
  wrong_count: 1,
  skipped_count: 1,
  accuracy: 50,
  xp_earned: 30,
  total_time_ms: 90000,
  finished_at: "2026-09-17T14:28:57.383Z",
  created_at: "2026-09-17T14:27:00.000Z",
};

/**
 * What PracticeService.listSessionAttempts hands it: the session's DURABLE
 * per-question record, which is the wrong and the skipped (§10.8). The right
 * answer of this three-question session is in the totals above — correct_count
 * 1 — and nowhere else.
 */
const records: PracticeAttemptRecord[] = [
  {
    generated_question: { question: "Q2", options: ["a", "b"], explanation: "because" },
    selected_answer: { index: 1, selected_index: 1, text: "b" },
    correct_answer: { index: 0, text: "a" },
    is_correct: false,
    skipped: false,
  },
  {
    generated_question: { question: "Q3", options: ["a", "b"] },
    selected_answer: { index: -1, selected_index: -1, text: "" },
    correct_answer: { index: 1, text: "b" },
    is_correct: false,
    skipped: true,
  },
];

describe("buildPracticeAnalysisSnapshot", () => {
  it("takes its totals from the session row, not from the attempt list", () => {
    const snap = buildPracticeAnalysisSnapshot(session, records);
    expect(snap).toMatchObject({
      version: 3,
      subject: "Mathematics",
      chapter: "Arithmetic Progressions",
      practiceMode: "chapter",
      difficulty: "easy",
      questionCount: 3,
      correctCount: 1,
      wrongCount: 1,
      skippedCount: 1,
      accuracy: 50,
      xpEarned: 30,
      totalTimeMs: 90000,
    });
    expect(snap.statistics.avgSecPerQuestion).toBe(30);
  });

  it("freezes the questions it is given, with the skip marked and no answer invented", () => {
    const snap = buildPracticeAnalysisSnapshot(session, records);
    expect(snap.attempts).toHaveLength(2);
    expect(snap.attempts[0]).toMatchObject({ question: "Q2", correctIndex: 0, selectedIndex: 1, isCorrect: false, skipped: false, explanation: "because" });
    // A skip has no selected option: -1, never 0, which would read as answer A.
    expect(snap.attempts[1]).toMatchObject({ question: "Q3", selectedIndex: -1, isCorrect: false, skipped: true });
    expect(snap.attempts[1].explanation).toBeUndefined();
  });

  /**
   * §10.8 — "no per-question record of correct answers" — is enforced where
   * the rows are read, in PracticeService.listSessionAttempts, so the review
   * list and this snapshot obey one rule. That read is measured in
   * practiceDurableRecord.test.ts; what this file pins is that the snapshot
   * reports the session's TOTALS, which is what a right answer leaves behind.
   */
  it("reports a right answer only through the totals", () => {
    const snap = buildPracticeAnalysisSnapshot(session, records);
    expect(snap.correctCount, "the session's own count of right answers").toBe(1);
    expect(snap.attempts.some((a) => a.isCorrect)).toBe(false);
  });

  it("stores no practice type label — the label comes from practice_mode", () => {
    const snap = buildPracticeAnalysisSnapshot(session, records) as unknown as Record<string, unknown>;
    expect(snap.practiceTypeLabel).toBeUndefined();
    expect(snap.practiceMode).toBe("chapter");
  });

  it("keeps a skipped-through session absent of accuracy, and says so", () => {
    const allSkipped = buildPracticeAnalysisSnapshot(
      { ...session, question_count: 3, correct_count: 0, wrong_count: 0, skipped_count: 3, accuracy: null, xp_earned: 25 },
      records.map((r) => ({ ...r, is_correct: false, skipped: true })),
    );
    expect(allSkipped.accuracy).toBeNull();
    expect(allSkipped.insights.headline).toMatch(/every question was skipped/i);
    expect(allSkipped.insights.bullets[0]).toBe("No question answered");
    expect(allSkipped.insights.recommendations.join(" ")).toMatch(/skipped/i);
  });

  it("never claims an achievement, at any score", () => {
    const perfect = buildPracticeAnalysisSnapshot(
      { ...session, correct_count: 3, wrong_count: 0, skipped_count: 0, accuracy: 100 },
      records,
    );
    const text = [perfect.insights.headline, ...perfect.insights.recommendations].join(" ").toLowerCase();
    // §10.8 — the number is allowed; a verdict on the student is not.
    for (const word of ["excellent", "mastered", "mastery", "strong", "proficient", "well done", "great"]) {
      expect(text).not.toContain(word);
    }
  });

  it("saves an all-correct session from totals alone when durable attempts are empty", () => {
    // §10.8 — right answers leave no per-question row. Save still freezes the
    // session totals so a perfect run is not refused.
    const snap = buildPracticeAnalysisSnapshot(
      { ...session, correct_count: 3, wrong_count: 0, skipped_count: 0, accuracy: 100, xp_earned: 40 },
      [],
    );
    expect(snap.correctCount).toBe(3);
    expect(snap.wrongCount).toBe(0);
    expect(snap.attempts).toEqual([]);
    expect(snap.insights.recommendations.join(" ")).toMatch(/nothing outstanding/i);
  });

  it("reads options that were stored as a JSON string", () => {
    const snap = buildPracticeAnalysisSnapshot(session, [
      { ...records[0], generated_question: { question: "Q", options: JSON.stringify(["x", "y"]) } },
    ]);
    expect(snap.attempts[0].options).toEqual(["x", "y"]);
  });
});
