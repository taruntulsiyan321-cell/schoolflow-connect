/**
 * A turn about a question the student opened Nova from goes to Nova's
 * tutoring chat, the only feature that reads question_context.
 *
 * Measured 2026-09-25 on www.gurukul.study: Mistake Book's Explain sent
 * "I got this question wrong. Explain why my answer is wrong…" with the
 * question attached; the word "Explain" routed it to student.concept.explain,
 * which answered "No concept mastery facts are available yet for that topic".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/edgeFunction", () => ({ invokeEdgeFunction: (...a: unknown[]) => invoke(...a) }));

import { askAiCoach } from "./gatewayClient";

const QUESTION = {
  question: "Identify the communication barrier highlighted here.",
  options: ["Premature evaluation", "Lack of attention", "Faulty translations", "Poor retention"],
  correctIndex: 2,
  studentAnswer: "Premature evaluation",
  studentAnswerIndex: 0,
  subject: "Business Studies",
  chapter: "Directing",
};
const MISTAKE_PROMPT = "I got this question wrong. Explain why my answer is wrong and walk me through the right one.";

const sentFeature = () => (invoke.mock.calls[0][1] as { feature_id: string }).feature_id;

describe("a question the student opened Nova from", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { request_id: "r", feature_id: "x", decision: "answered_model", route_class: "c", used_model: true, cache_hit: false, data: { reply: "ok" } },
      error: null,
    });
  });

  it("goes to Nova's tutoring chat, whatever the words, and carries the question", async () => {
    await askAiCoach({ text: MISTAKE_PROMPT, channel: "student_app", questionContext: QUESTION });
    expect(sentFeature()).toBe("student.nova.chat");
    const body = invoke.mock.calls[0][1] as { input: { structured: { question_context: { question: string } } } };
    expect(body.input.structured.question_context.question).toBe(QUESTION.question);
  });

  it("CONTROL: the same words with no question still route by their intent", async () => {
    await askAiCoach({ text: MISTAKE_PROMPT, channel: "student_app" });
    expect(sentFeature()).toBe("student.concept.explain");
  });
});
