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
  MIN_USABLE_QUESTIONS,
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
  // chapter/topic/subject are free-text labels the edge resolves to live ids
  // (§5, §7). Null here: an unusable upload never gets that far.
  return { title, body, chapter: null, topic: null, subject: null };
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
