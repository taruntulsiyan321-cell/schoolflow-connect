/**
 * §4 refusal gates for Custom Practice uploads.
 * Binding: docs/custom-practice-upload-spec.md §4.2–§4.4
 *
 * Imports only Deno-free refusalGates + types — never classify/modelRouter.
 */
import { describe, expect, it } from "vitest";
import {
  applyRefusalGates,
  CONFIDENCE_THRESHOLD,
  isAskable,
  MIN_USABLE_QUESTIONS,
  tooFewToPractise,
} from "../../../supabase/functions/custom-practice-upload/refusalGates";
import type {
  ClassifierResult,
  ExtractedNote,
  ExtractedQuestion,
} from "../../../supabase/functions/custom-practice-upload/types";

function mcq(stem: string, correctIndex = 0): ExtractedQuestion {
  return {
    question_text: stem,
    options: ["A", "B", "C", "D"],
    correct_index: correctIndex,
    correct_answer: "A",
    answer_source: "ai",
    explanation: "Mock explanation for the stem.",
    difficulty: "medium",
    // Required, and null on purpose: these fixtures come from a question paper,
    // not from notes. The field is `string | null` rather than optional so every
    // producer has to SAY which it is (§7.1).
    derived_from_note_title: null,
  };
}

function note(title: string, body: string): ExtractedNote {
  return { title, body };
}

function assertZeroRows(result: ClassifierResult) {
  expect(result.verdict).toBe("unusable");
  expect(result.questions).toEqual([]);
  expect(result.notes).toEqual([]);
  expect(result.questions.length + result.notes.length).toBe(0);
}

describe("applyRefusalGates — §4.2–§4.4", () => {
  it("forces unusable and clears rows when confidence is below threshold (§4.2)", () => {
    const gated = applyRefusalGates({
      verdict: "questions",
      confidence: CONFIDENCE_THRESHOLD - 0.01,
      refusal_reason: null,
      questions: [
        mcq("What is 2 + 2? Write the sum."),
        mcq("What is 3 + 3? Write the sum."),
        mcq("What is 4 + 4? Write the sum."),
      ],
      notes: [note("Scratch", "A long enough note body for normalize.")],
    });

    assertZeroRows(gated);
    expect(gated.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
    expect(gated.refusal_reason).toMatch(/confident/i);
  });

  it("keeps model refusal for non-question content and writes zero rows (§4.1 / §4.3)", () => {
    const gated = applyRefusalGates({
      verdict: "unusable",
      confidence: 0.92,
      refusal_reason: "Looks like a class timetable, not practice questions or notes.",
      questions: [mcq("Period 1 Mathematics room 12")],
      notes: [note("Schedule", "Monday through Friday period list transcribed.")],
    });

    assertZeroRows(gated);
    expect(gated.refusal_reason).toMatch(/timetable/i);
  });

  it("refuses fewer than MIN_USABLE_QUESTIONS with no notes (§4.4)", () => {
    const two = applyRefusalGates({
      verdict: "questions",
      confidence: 0.88,
      refusal_reason: null,
      questions: [
        mcq("Solve for x: 2x = 10."),
        mcq("Solve for y: 3y = 12."),
      ],
      notes: [],
    });

    assertZeroRows(two);
    expect(two.refusal_reason).toMatch(/Only 2 usable/);
    expect(two.refusal_reason).toContain(String(MIN_USABLE_QUESTIONS));
  });

  it("refuses a single usable question with no notes (§4.4)", () => {
    const one = applyRefusalGates({
      verdict: "questions",
      confidence: 0.95,
      refusal_reason: null,
      questions: [mcq("Name the SI unit of force.")],
      notes: [],
    });

    assertZeroRows(one);
    expect(one.refusal_reason).toMatch(/Only 1 usable/);
  });

  it("accepts three usable questions above threshold (positive control)", () => {
    const questions = [
      mcq("What is the derivative of x²?"),
      mcq("What is the integral of 2x dx?"),
      mcq("What is the limit of (1+1/n)^n as n→∞?"),
    ];
    const gated = applyRefusalGates({
      verdict: "questions",
      confidence: CONFIDENCE_THRESHOLD,
      refusal_reason: null,
      questions,
      notes: [],
    });

    expect(gated.verdict).toBe("questions");
    expect(gated.refusal_reason).toBeNull();
    expect(gated.questions).toHaveLength(3);
    expect(gated.notes).toEqual([]);
  });
});

/**
 * Found 2026-09-29: §4.4 counted every question the model returned. A
 * question whose answer is text only cannot be practised — Practice drops it —
 * so a file of written-answer questions was accepted and every mode opened an
 * empty session. And the count ran before another subject's questions were
 * set aside, so five questions, three of them Chemistry, left two.
 */
function written(stem: string): ExtractedQuestion {
  return { ...mcq(stem), options: null, correct_index: null, correct_answer: "42" };
}

describe("§4.4 counts questions that can be practised", () => {
  it("a question needs two options and an index to be practised", () => {
    expect(isAskable(mcq("Q"))).toBe(true);
    expect(isAskable(written("Q"))).toBe(false);
    expect(isAskable({ options: ["only one"], correct_index: 0 })).toBe(false);
    expect(isAskable({ options: ["a", "b"], correct_index: null })).toBe(false);
  });

  it("refuses a file of written-answer questions, however many", () => {
    const gated = applyRefusalGates({
      verdict: "questions", confidence: 0.9, refusal_reason: null,
      questions: [written("One"), written("Two"), written("Three"), written("Four")],
      notes: [],
    });
    assertZeroRows(gated);
    expect(gated.refusal_reason).toMatch(/No usable questions/);
  });

  it("counts only the practisable ones: two MCQs and three written answers is too few", () => {
    const gated = applyRefusalGates({
      verdict: "questions", confidence: 0.9, refusal_reason: null,
      questions: [mcq("A"), mcq("B"), written("C"), written("D"), written("E")],
      notes: [],
    });
    assertZeroRows(gated);
    expect(gated.refusal_reason).toMatch(/Only 2 usable/);
  });

  it("CONTROL: three MCQs beside written answers are enough, and every question is kept", () => {
    const gated = applyRefusalGates({
      verdict: "questions", confidence: 0.9, refusal_reason: null,
      questions: [mcq("A"), mcq("B"), mcq("C"), written("D")],
      notes: [],
    });
    expect(gated.verdict).toBe("questions");
    expect(gated.questions).toHaveLength(4);
  });

  it("is re-applied to what is kept: two left after another subject is set aside is too few", () => {
    expect(tooFewToPractise([mcq("A"), mcq("B")], 0)).toMatch(/Only 2 usable/);
    expect(tooFewToPractise([mcq("A"), mcq("B"), mcq("C")], 0)).toBeNull();
    // Notes make a file usable on their own (§8: read, and practise from them).
    expect(tooFewToPractise([], 1)).toBeNull();
  });
});
