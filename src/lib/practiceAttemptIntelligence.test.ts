import { describe, expect, it } from "vitest";
import {
  attemptsToFinishPayload,
  buildAttemptMeta,
  type PracticeAttemptSnapshot,
} from "./practiceSessionSnapshot";

describe("attemptsToFinishPayload — full intelligence capture", () => {
  it("includes every Practice Intelligence field on skip", () => {
    const attempts: PracticeAttemptSnapshot[] = [
      {
        question: "Q1",
        options: ["a", "b", "c", "d"],
        correctIndex: 1,
        selectedIndex: -1,
        isCorrect: false,
        skipped: true,
        bankQuestionId: "bank-1",
        subject: "Accountancy",
        chapter: "Partnership",
        concept: "Partnership",
        topic: "Admission",
        difficulty: "medium",
        source: "practice",
        practiceMode: "skipped",
        sourceId: "session-1",
        timeTakenMs: 1200,
        hintUsed: false,
        solutionViewed: false,
        timedOut: false,
        attemptNumber: 1,
        classLevel: 12,
        board: "rbse",
        stream: "commerce",
        schoolId: "school-1",
        answeredAt: "2026-08-02T10:00:00.000Z",
      },
    ];
    const payload = attemptsToFinishPayload(attempts);
    expect(payload).toHaveLength(1);
    const row = payload[0];
    expect(row.skipped).toBe(true);
    expect(row.is_correct).toBe(false);
    expect(row.score).toBe(0);
    expect(row.bank_question_id).toBe("bank-1");
    expect(row.source).toBe("practice");
    expect(row.practice_mode).toBe("skipped");
    expect(row.source_id).toBe("session-1");
    expect(row.time_taken_ms).toBe(1200);
    expect(row.hint_used).toBe(false);
    expect(row.solution_viewed).toBe(false);
    expect(row.timed_out).toBe(false);
    expect(row.attempt_number).toBe(1);
    expect(row.class_level).toBe(12);
    expect(row.board).toBe("rbse");
    expect(row.stream).toBe("commerce");
    expect(row.school_id).toBe("school-1");
    expect(row.topic).toBe("Admission");
    expect(row.difficulty).toBe("medium");
    expect(row.generated_question.question).toBe("Q1");
    expect(row.generated_question.practice_mode).toBe("skipped");
    expect(row.meta.practice_mode).toBe("skipped");
    expect(row.meta.source_id).toBe("session-1");
    expect(row.meta.class_level).toBe(12);
    expect(row.meta.board).toBe("rbse");
    expect(row.meta.stream).toBe("commerce");
    expect(row.selected_answer).toMatchObject({ index: -1, selected_index: -1 });
    expect(row.correct_answer).toMatchObject({ index: 1, correct_index: 1 });
  });

  it("keeps wrong answers as not skipped so Incorrect mode can load them", () => {
    const attempts: PracticeAttemptSnapshot[] = [
      {
        question: "Q2",
        options: ["a", "b"],
        correctIndex: 0,
        selectedIndex: 1,
        isCorrect: false,
        skipped: false,
        bankQuestionId: "bank-2",
        source: "practice",
        practiceMode: "incorrect",
        solutionViewed: true,
        hintUsed: true,
        timeTakenMs: 4500,
        confidence: 0.4,
        attemptNumber: 2,
      },
    ];
    const payload = attemptsToFinishPayload(attempts);
    expect(payload[0].skipped).toBe(false);
    expect(payload[0].is_correct).toBe(false);
    expect(payload[0].score).toBe(0);
    expect(payload[0].solution_viewed).toBe(true);
    expect(payload[0].hint_used).toBe(true);
    expect(payload[0].confidence).toBe(0.4);
    expect(payload[0].meta.solution_viewed).toBe(true);
    expect(payload[0].meta.hint_used).toBe(true);
  });

  it("scores correct answers and marks solution viewed", () => {
    const payload = attemptsToFinishPayload([
      {
        question: "Q3",
        options: ["a", "b"],
        correctIndex: 0,
        selectedIndex: 0,
        isCorrect: true,
        bankQuestionId: "bank-3",
        solutionViewed: true,
        practiceMode: "daily",
      },
    ]);
    expect(payload[0].skipped).toBe(false);
    expect(payload[0].is_correct).toBe(true);
    expect(payload[0].score).toBe(1);
    expect(payload[0].source).toBe("practice");
    expect(payload[0].practice_mode).toBe("daily");
    expect(payload[0].solution_viewed).toBe(true);
  });

  it("treats timed_out as skipped with zero score", () => {
    const payload = attemptsToFinishPayload([
      {
        question: "Q4",
        options: ["a", "b"],
        correctIndex: 0,
        selectedIndex: -1,
        isCorrect: false,
        timedOut: true,
        skipped: true,
        bankQuestionId: "bank-4",
        practiceMode: "timed",
        timeTakenMs: 30000,
      },
    ]);
    expect(payload[0].skipped).toBe(true);
    expect(payload[0].timed_out).toBe(true);
    expect(payload[0].is_correct).toBe(false);
    expect(payload[0].score).toBe(0);
    expect(payload[0].meta.timed_out).toBe(true);
  });
});

describe("buildAttemptMeta", () => {
  it("defaults answered_at and maps curriculum scope fields", () => {
    const meta = buildAttemptMeta({
      question: "x",
      options: ["a", "b"],
      correctIndex: 0,
      selectedIndex: 1,
      isCorrect: false,
      practiceMode: "weak",
      classLevel: 11,
      board: "rbse",
      stream: "science",
    });
    expect(meta.practice_mode).toBe("weak");
    expect(meta.class_level).toBe(11);
    expect(meta.board).toBe("rbse");
    expect(meta.stream).toBe("science");
    expect(typeof meta.answered_at).toBe("string");
  });
});

describe("Practice mode catalog — exactly nine modes", () => {
  it("advertises the nine Practice Engine V1 modes and nothing else", async () => {
    // Static check against source so UI regressions are caught without mounting React.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../gurukul/pages/Practice.tsx"),
      "utf8",
    );

    const required = [
      "subject", "chapter", "topic", "custom",
      "pyq", "weak", "incorrect", "skipped", "bookmarked",
    ];
    for (const key of required) {
      expect(src).toMatch(new RegExp(`key:"${key}"`));
    }

    // Removed: a time limit is now a Custom Practice goal, not its own mode.
    // Only the Mock Tests entry point is gone — the teacher test system it
    // used is untouched.
    const removed = ["daily", "teacher", "timed", "untimed", "mock", "qbank"];
    for (const key of removed) {
      expect(src).not.toMatch(new RegExp(`key:"${key}"`));
    }

    expect(src).not.toMatch(/label:"Question Bank"/);
    expect(src).not.toMatch(/label:"Mixed Practice"/);
    expect(src).not.toMatch(/label:"Random Practice"/);
    expect(src).toMatch(
      /INSTANT: ModeKey\[\] = \["weak", "incorrect", "skipped", "bookmarked"\]/,
    );
  });

  it("keeps the Custom Practice goal types mutually exclusive", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../gurukul/pages/Practice.tsx"),
      "utf8",
    );
    // Exactly one goal input is mounted at a time — a ternary on goalType,
    // never two independently-rendered controls.
    expect(src).toMatch(/goalType === "count" \? \(/);
    expect(src).toMatch(/\[10, 20, 30, 50\]/);
    expect(src).toMatch(/\[10, 20, 30, 45, 60\]/);
  });
});
