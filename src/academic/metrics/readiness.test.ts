import { describe, expect, it } from "vitest";
import { readiness, subjectKey } from "./readiness";
import { READINESS_MIN_COVERAGE_PCT } from "./thresholds";

const PAPER = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 };

describe("readiness: a paper in one subject, today", () => {
  it("at 30% over 120 answers, answering all 50: 50 × (0.3 × 5 − 0.7 × 1) = 40 of 250", () => {
    expect(READINESS_MIN_COVERAGE_PCT).toBe(50);
    expect(readiness({ subject: "Accountancy", answered: 120, correct: 36, chapters: 11, practised: 6 }, PAPER)).toEqual({
      subject: "Accountancy", kind: "estimate", accuracy: 30, answered: 120, practised: 6, chapters: 11,
      marks: 40, maxMarks: 250, perQuestion: 0.8,
    });
  });

  it("under one in six right, a question answered costs more than it earns", () => {
    const r = readiness({ subject: "Economics", answered: 60, correct: 6, chapters: 10, practised: 5 }, PAPER);
    expect(r).toMatchObject({ kind: "estimate", accuracy: 10, marks: -20, perQuestion: -0.4 });
  });

  it("not yet: under half the chapters (6 of 11 needed), or fewer answers than the paper has questions", () => {
    expect(readiness({ subject: "Accountancy", answered: 200, correct: 100, chapters: 11, practised: 5 }, PAPER))
      .toEqual({ subject: "Accountancy", kind: "not_yet", practised: 5, chapters: 11, answered: 200, needChapters: 6, needAnswers: 50 });
    expect(readiness({ subject: "Accountancy", answered: 49, correct: 40, chapters: 11, practised: 11 }, PAPER).kind).toBe("not_yet");
    // CONTROL: exactly at both lines, it is said.
    expect(readiness({ subject: "Accountancy", answered: 50, correct: 25, chapters: 11, practised: 6 }, PAPER).kind).toBe("estimate");
  });

  it("a subject with no syllabus chapters is never estimated", () => {
    expect(readiness({ subject: "X", answered: 500, correct: 400, chapters: 0, practised: 0 }, PAPER).kind).toBe("not_yet");
  });

  it("one subject, however the two sources write it", () => {
    expect(subjectKey("  Business  Studies ")).toBe(subjectKey("business studies"));
  });
});

describe("readiness rows: every practised syllabus subject", () => {
  const ch = (chapterId: string, subject: string, answered: number) => ({
    chapterId, chapter: chapterId, subject, sequence: 1, answered, correct: 0, recentAnswered: 0, recentCorrect: 0, lastAt: null,
  });
  const map = {
    examFound: true, recentDays: 14, topics: [], topicsLocked: false,
    chapters: [ch("a1", "Accountancy", 30), ch("a2", "Accountancy", 0), ch("e1", "Economics", 3), ch("e2", "Economics", 0), ch("e3", "Economics", 0), ch("m1", "Mathematics", 0)],
  };

  it("accuracy from practice, coverage from the map; a subject never practised is left out", async () => {
    const { readinessRows } = await import("./readiness");
    const rows = readinessRows(PAPER, map, [
      { subject: "accountancy", answered: 60, correct: 30 }, // 1 of 2 chapters, 60 answers: estimated
      { subject: "Economics", answered: 3, correct: 1 }, // 1 of 3 chapters: not yet
    ]);
    expect(rows.map((r) => [r.subject, r.kind])).toEqual([["Accountancy", "estimate"], ["Economics", "not_yet"]]);
    // 50 × (0.5 × 5 − 0.5 × 1) = 100.
    expect(rows[0]).toMatchObject({ marks: 100, accuracy: 50 });
    expect(rows[1]).toMatchObject({ needChapters: 2, needAnswers: 50 });
  });
});
