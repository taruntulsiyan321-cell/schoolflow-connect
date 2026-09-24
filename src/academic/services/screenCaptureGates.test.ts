/**
 * Pure gates for screen-capture Stage 1 — docs/screen-capture-mistakes-spec.md §5–§6.
 */
import { describe, expect, it } from "vitest";
import {
  applyIntakeGates,
  applyVerdictGates,
  fingerprintQuestionText,
  type FrameExtraction,
} from "../../../supabase/functions/screen-capture-mistake/gates.ts";

const PW = "com.physicswallah.pw";

function base(over: Partial<FrameExtraction> = {}): FrameExtraction {
  return {
    confidence: 0.9,
    score_only: false,
    teacher_solve: false,
    question_text: "Which is a function of management?",
    options: ["Planning", "Cooking", "Painting", "Singing"],
    student_chosen_index: 1,
    correct_index: 0,
    correct_answer: null,
    student_was_wrong: true,
    answer_source: "screen",
    ...over,
  };
}

describe("screen-capture intake gates (§5.1 / §5.2)", () => {
  it("drops unlisted apps without reading", () => {
    const r = applyIntakeGates({
      package_name: "com.whatsapp",
      allowed_packages: [PW],
    });
    expect(r).toEqual({ ok: false, reason: "app_not_allowed", read: false });
  });

  it("allows listed package", () => {
    expect(
      applyIntakeGates({ package_name: PW, allowed_packages: [PW] }),
    ).toEqual({ ok: true });
  });

  it("drops lecture suspect before read", () => {
    const r = applyIntakeGates({
      package_name: PW,
      allowed_packages: [PW],
      is_lecture_suspect: true,
    });
    expect(r).toEqual({ ok: false, reason: "lecture_playing", read: false });
  });
});

describe("screen-capture verdict gates (§6.3–§6.5)", () => {
  it("accepts a wrong answer with student choice + verdict", () => {
    const r = applyVerdictGates(base());
    expect(r.ok).toBe(true);
  });

  it("refuses a correct answer", () => {
    const r = applyVerdictGates(base({ student_was_wrong: false }));
    expect(r).toMatchObject({ ok: false, reason: "correct_answer", read: true });
  });

  it("refuses teacher solve (§6.4)", () => {
    const r = applyVerdictGates(base({ teacher_solve: true }));
    expect(r).toMatchObject({ ok: false, reason: "teacher_solve", read: true });
  });

  it("refuses score-only (§6.5)", () => {
    const r = applyVerdictGates(
      base({
        score_only: true,
        question_text: null,
        student_was_wrong: null,
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "score_only", read: true });
  });

  it("refuses missing student verdict", () => {
    const r = applyVerdictGates(
      base({ student_was_wrong: null, student_chosen_index: null }),
    );
    expect(r).toMatchObject({ ok: false, reason: "no_student_verdict", read: true });
  });
});

describe("fingerprint (§7.3)", () => {
  it("collapses whitespace and punctuation", () => {
    expect(fingerprintQuestionText("  Hello, World!  ")).toBe(
      fingerprintQuestionText("hello world"),
    );
  });
});
