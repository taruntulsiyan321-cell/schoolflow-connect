import { describe, expect, it } from "vitest";
import { attemptsToFinishPayload, type PracticeAttemptSnapshot } from "./practiceSessionSnapshot";

describe("attemptsToFinishPayload — skip + wrong intelligence", () => {
  it("marks skipped attempts with skipped:true and zero score", () => {
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
        source: "practice",
      },
    ];
    const payload = attemptsToFinishPayload(attempts);
    expect(payload).toHaveLength(1);
    expect(payload[0].skipped).toBe(true);
    expect(payload[0].is_correct).toBe(false);
    expect(payload[0].score).toBe(0);
    expect(payload[0].bank_question_id).toBe("bank-1");
    expect(payload[0].source).toBe("practice");
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
      },
    ];
    const payload = attemptsToFinishPayload(attempts);
    expect(payload[0].skipped).toBe(false);
    expect(payload[0].is_correct).toBe(false);
    expect(payload[0].score).toBe(0);
  });

  it("scores correct answers", () => {
    const payload = attemptsToFinishPayload([
      {
        question: "Q3",
        options: ["a", "b"],
        correctIndex: 0,
        selectedIndex: 0,
        isCorrect: true,
        bankQuestionId: "bank-3",
      },
    ]);
    expect(payload[0].skipped).toBe(false);
    expect(payload[0].is_correct).toBe(true);
    expect(payload[0].score).toBe(1);
    expect(payload[0].source).toBe("practice");
  });
});

describe("Practice mode catalog — removed modes", () => {
  it("does not advertise removed friction modes in the hub catalog", async () => {
    // Static check against source so UI regressions are caught without mounting React.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../gurukul/pages/Practice.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/key:"qbank"/);
    expect(src).not.toMatch(/label:"Question Bank"/);
    expect(src).not.toMatch(/label:"Custom Practice"/);
    expect(src).not.toMatch(/label:"Mixed Practice"/);
    expect(src).not.toMatch(/label:"Random Practice"/);
    expect(src).toMatch(/key:"incorrect"/);
    expect(src).toMatch(/key:"skipped"/);
    expect(src).toMatch(/key:"weak"/);
    expect(src).toMatch(/key:"daily"/);
    expect(src).toMatch(/key:"pyq"/);
    expect(src).toMatch(/key:"subject"/);
    expect(src).toMatch(/INSTANT: ModeKey\[\] = \["daily", "weak", "incorrect", "skipped"\]/);
  });
});
