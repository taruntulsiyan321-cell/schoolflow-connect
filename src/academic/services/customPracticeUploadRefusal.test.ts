/**
 * §4 refusal gates for Custom Practice uploads.
 * Binding: docs/custom-practice-upload-spec.md §4.2–§4.4
 *
 * Imports only Deno-free refusalGates + types — never classify/modelRouter.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyRefusalGates,
  CONFIDENCE_THRESHOLD,
  isAskable,
  MIN_USABLE_QUESTIONS,
  mayClassify,
  PROCESSING_STALE_MS,
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
 * A file is classified once.
 *
 * Measured on production 2026-09-27: a CUET Commerce account uploaded a
 * Chemistry worksheet, answered three of its questions a minute later, and
 * hours later the same file was classified again — which deleted the questions
 * under them (§4.3) and spent a second Custom Practice upload from their plan
 * for a verdict already made. The screen only offers "Try again" for
 * pending and failed; these are the server's own fence.
 */
describe("may this upload be classified again?", () => {
  const NOW = Date.parse("2026-09-28T12:00:00Z");

  it("runs for a new file, and for the retry the screen offers", () => {
    expect(mayClassify({ status: "pending" }, NOW).ok).toBe(true);
    expect(mayClassify({ status: "failed" }, NOW).ok).toBe(true);
    // A row whose status has not been set yet is a first run, not a refusal.
    expect(mayClassify({}, NOW).ok).toBe(true);
  });

  it("refuses a file that already has a verdict, and says why", () => {
    for (const status of ["ready", "unusable"]) {
      const r = mayClassify({ status }, NOW);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("unreachable");
      expect(r.code).toBe("already_classified");
      expect(r.message).toBe("This file has already been checked, so it was not read again.");
    }
  });

  it("refuses one still being read, until it has been stuck long enough to be dead", () => {
    const justStarted = new Date(NOW - 1000).toISOString();
    const fresh = mayClassify({ status: "processing", updated_at: justStarted }, NOW);
    expect(fresh.ok).toBe(false);
    if (fresh.ok) throw new Error("unreachable");
    expect(fresh.code).toBe("already_processing");

    // A crash between "processing" and a verdict must not strand the file.
    const stuck = new Date(NOW - PROCESSING_STALE_MS - 1000).toISOString();
    expect(mayClassify({ status: "processing", updated_at: stuck }, NOW).ok).toBe(true);
    // CONTROL: exactly one millisecond before the window, it is still refused.
    expect(mayClassify({ status: "processing", updated_at: new Date(NOW - PROCESSING_STALE_MS + 1).toISOString() }, NOW).ok)
      .toBe(false);
  });

  it("treats a processing row with no timestamp as still processing, not as free", () => {
    expect(mayClassify({ status: "processing" }, NOW).ok).toBe(false);
    expect(mayClassify({ status: "processing", updated_at: "not a date" }, NOW).ok).toBe(false);
  });
});

/**
 * The wiring, not just the rule: a refused re-run must cost nothing, which is
 * only true if the status is checked BEFORE the plan is asked. The unit tests
 * above cannot see that — the order lives in index.ts.
 */
describe("where the guard sits in custom-practice-upload", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "..", "supabase", "functions", "custom-practice-upload", "index.ts"),
    "utf8",
  );

  it("asks mayClassify before it consumes a plan use", () => {
    const guard = source.indexOf("mayClassify(upload)");
    const charge = source.indexOf('premiumConsume(admin, uid, "custom_practice.upload")');
    expect(guard).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(charge);
  });

  it("reads the status and the timestamp the guard needs", () => {
    expect(source).toMatch(/\.select\("id, owner_id, school_id, status, updated_at,/);
  });

  it("answers a refused re-run with 409 and the guard's own words", () => {
    expect(source).toMatch(/error: reclassify\.message, error_code: reclassify\.code/);
    expect(source).toMatch(/\}, 409\)/);
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
