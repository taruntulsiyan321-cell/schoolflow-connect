/**
 * §4 refusal gates for Custom Practice uploads.
 * Binding: docs/custom-practice-upload-spec.md §4.2–§4.4
 *
 * Mock-model responses only — no live OpenRouter, no demo student names.
 * Unusable verdicts must leave zero question/note rows (§4.3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifierResult, ExtractedQuestion } from "../../../supabase/functions/custom-practice-upload/types";

const { completeWithQwenMock } = vi.hoisted(() => ({
  completeWithQwenMock: vi.fn(),
}));

vi.mock("../../../supabase/functions/_shared/modelRouter.ts", () => ({
  completeWithQwen: completeWithQwenMock,
  getConfiguredModelId: () => "mock/qwen-test",
  isOpenRouterConfigured: () => true,
}));

import {
  applyRefusalGates,
  classifyUploadMedia,
  CONFIDENCE_THRESHOLD,
  MIN_USABLE_QUESTIONS,
} from "../../../supabase/functions/custom-practice-upload/classify";

function mcq(stem: string, correctIndex = 0): ExtractedQuestion {
  return {
    question_text: stem,
    options: ["A", "B", "C", "D"],
    correct_index: correctIndex,
    correct_answer: "A",
    answer_source: "ai",
    explanation: "Mock explanation for the stem.",
    difficulty: "medium",
  };
}

function modelPayload(partial: {
  verdict: ClassifierResult["verdict"];
  confidence: number;
  refusal_reason?: string | null;
  questions?: ExtractedQuestion[];
  notes?: ClassifierResult["notes"];
}): string {
  return JSON.stringify({
    verdict: partial.verdict,
    confidence: partial.confidence,
    refusal_reason: partial.refusal_reason ?? null,
    questions: partial.questions ?? [],
    notes: partial.notes ?? [],
  });
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
      notes: [{ title: "Scratch", body: "A long enough note body for normalize." }],
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
      notes: [{ title: "Schedule", body: "Monday through Friday period list transcribed." }],
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

describe("classifyUploadMedia — mocked model §4 refusal", () => {
  beforeEach(() => {
    completeWithQwenMock.mockReset();
  });

  it("low-confidence model JSON → unusable, zero rows", async () => {
    completeWithQwenMock.mockResolvedValue({
      ok: true,
      text: modelPayload({
        verdict: "questions",
        confidence: 0.4,
        questions: [
          mcq("Mock stem alpha for low confidence."),
          mcq("Mock stem beta for low confidence."),
          mcq("Mock stem gamma for low confidence."),
        ],
      }),
      model_id: "mock/qwen-test",
      source: "openrouter_qwen",
    });

    const outcome = await classifyUploadMedia({
      kind: "text",
      text: "blurry scan of a worksheet",
      page_count: 1,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    assertZeroRows(outcome.result);
  });

  it("non-question model verdict → unusable, zero rows", async () => {
    completeWithQwenMock.mockResolvedValue({
      ok: true,
      text: modelPayload({
        verdict: "unusable",
        confidence: 0.91,
        refusal_reason: "This is a chat screenshot, not study questions or notes.",
        questions: [],
        notes: [],
      }),
      model_id: "mock/qwen-test",
      source: "openrouter_qwen",
    });

    const outcome = await classifyUploadMedia({
      kind: "text",
      text: "WhatsApp export: hey are you free after school?",
      page_count: 1,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    assertZeroRows(outcome.result);
    expect(outcome.result.refusal_reason).toMatch(/chat/i);
  });

  it("fewer than 3 extracted questions → unusable, zero rows", async () => {
    completeWithQwenMock.mockResolvedValue({
      ok: true,
      text: modelPayload({
        verdict: "questions",
        confidence: 0.86,
        questions: [mcq("Only one real question on this page.")],
        notes: [],
      }),
      model_id: "mock/qwen-test",
      source: "openrouter_qwen",
    });

    const outcome = await classifyUploadMedia({
      kind: "text",
      text: "Q1. Only one real question on this page.",
      page_count: 1,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    assertZeroRows(outcome.result);
    expect(outcome.result.refusal_reason).toMatch(/Only 1 usable/);
  });
});
