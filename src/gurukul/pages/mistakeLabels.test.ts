/**
 * A mistake's labels: every row names a subject and a chapter, and a topic is
 * not the chapter said twice.
 *
 * Live, 2026-09-25 (CUET audit account): a Chemistry upload outside the exam's
 * chapters showed as a nameless Subject Breakdown row and a blank subject chip,
 * with "- · -" for its chapter and topic; a tagged Economics upload read
 * "Macroeconomics · Macroeconomics".
 */
import { describe, expect, it } from "vitest";
import { mapRowToMistake, type MistakeRow as Row } from "./mistakeRow";

const row = (over: Partial<Row>): Row => ({
  id: "m1", question_text: "Q", options: ["a", "b"], correct_answer: null, student_answer: null,
  subject: "Economics", chapter: "Macroeconomics", concept: null, topic: null, source: "upload",
  assessment_type: "upload", last_wrong_at: "2026-09-25T03:00:00Z", times_wrong: 1, explanation: null,
  status: "open", ...over,
});

describe("mistake labels", () => {
  it("files an upload nobody could place as Untagged, not as a blank", () => {
    const m = mapRowToMistake(row({ subject: "", chapter: null, concept: null, topic: null }), false);
    expect(m.subject).toBe("Untagged");
    expect(m.chapter).toBe("Untagged");
    expect(m.topic).toBe("");
  });

  it("files a screen capture nobody could place the same way", () => {
    const m = mapRowToMistake(row({ source: "screen_capture", subject: "", chapter: null }), false);
    expect([m.subject, m.chapter]).toEqual(["Untagged", "Untagged"]);
  });

  it("does not repeat the chapter as the topic", () => {
    const m = mapRowToMistake(row({ concept: "Macroeconomics", topic: "Macroeconomics" }), false);
    expect(m.chapter).toBe("Macroeconomics");
    expect(m.topic).toBe("");
  });

  it("CONTROL: keeps a topic that is not the chapter", () => {
    const m = mapRowToMistake(row({ subject: "Accountancy", chapter: "Reconstitution of Partnership", concept: "Revaluation Account" }), false);
    expect(m.subject).toBe("Accountancy");
    expect(m.chapter).toBe("Reconstitution of Partnership");
    expect(m.topic).toBe("Revaluation Account");
  });
});
