import { describe, expect, it } from "vitest";
import { extractJson, schemaShape } from "../../../supabase/functions/_shared/structuredJson.ts";

/**
 * A structured prompt shows the model an example of the answer, never the
 * JSON Schema. Shown the schema, Qwen answered in its shape and the variant
 * answer check found no answer for the question it asked — 6 of 10 checks on
 * 2026-09-24, so no recovery variant was stored for a CUET mistake.
 */
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          working: { type: "string" },
          correct_index: { type: "integer", minimum: -1, maximum: 3 },
          exactly_one_correct: { type: "boolean" },
        },
        required: ["n", "working", "correct_index", "exactly_one_correct"],
      },
    },
  },
  required: ["answers"],
};

const schemaWords = (v: unknown) => JSON.stringify(v).match(/"(type|properties|items|required)"/g) ?? [];

describe("schemaShape — the model is shown an answer, not a schema", () => {
  it("turns the answer-check schema into one example answer", () => {
    expect(schemaShape(CHECK_SCHEMA)).toEqual({
      answers: [{ n: 0, working: "", correct_index: 0, exactly_one_correct: false }],
    });
    expect(schemaWords(schemaShape(CHECK_SCHEMA))).toEqual([]);
  });

  it("POSITIVE CONTROL: the schema itself is full of the words the model echoed", () => {
    expect(schemaWords(CHECK_SCHEMA).length).toBeGreaterThan(5);
  });

  it("takes an enum's first value, a positive minimum, and nullable types", () => {
    expect(schemaShape({
      type: "object",
      properties: {
        style: { type: "string", enum: ["standard", "simpler"] },
        count: { type: "integer", minimum: 2 },
        note: { type: ["string", "null"] },
        tags: { type: "array", items: { type: "string" } },
        free: { type: "array" },
      },
    })).toEqual({ style: "standard", count: 2, note: "", tags: [""], free: [] });
  });

  it("leaves an example shape alone — Nova's revision prompts already pass one", () => {
    const shape = { title: "", key_points: [{ heading: "", detail: "" }], opening_question: "" };
    expect(schemaShape(shape)).toBe(shape);
    // An example whose own field is NAMED "type" is still an example.
    const withTypeField = { type: { label: "" }, answer: "" };
    expect(schemaShape(withTypeField)).toBe(withTypeField);
  });
});

describe("extractJson — the object in a reply, whatever is wrapped around it", () => {
  const answer = { answers: [{ n: 0, working: "5 × 3 = 15", correct_index: 2, exactly_one_correct: true }] };

  it("reads a clean reply, a fenced one, and one with a sentence either side", () => {
    expect(extractJson(JSON.stringify(answer))).toEqual(answer);
    expect(extractJson("```json\n" + JSON.stringify(answer) + "\n```")).toEqual(answer);
    expect(extractJson("Here is the JSON:\n" + JSON.stringify(answer) + "\nLet me know if you need more.")).toEqual(answer);
  });

  it("POSITIVE CONTROL: a reply that is not JSON, or is cut off, still fails", () => {
    expect(() => extractJson("I could not solve this question.")).toThrow();
    expect(() => extractJson(JSON.stringify(answer).slice(0, 40))).toThrow();
  });
});
