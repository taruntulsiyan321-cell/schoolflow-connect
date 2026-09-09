import { describe, it, expect } from "vitest";
import { answerToText } from "./answerText";

const OPTS = ["6", "9", "12"];

describe("answerToText", () => {
  it("resolves an index into the option it names", () => {
    expect(answerToText({ indexes: [1] }, OPTS)).toBe("9");
  });

  it("resolves the legacy correct_index shape the seeded rows still carry", () => {
    expect(answerToText({ correct_index: 2 }, OPTS)).toBe("12");
  });

  it("joins a multi-select answer", () => {
    expect(answerToText({ indexes: [0, 2] }, OPTS)).toBe("6 · 12");
  });

  it("reads free text and numerical answers", () => {
    expect(answerToText({ text: "  photosynthesis " }, null)).toBe("photosynthesis");
    expect(answerToText({ value: 42 }, null)).toBe("42");
  });

  // The whole point of the null contract: a position with no list beside it is
  // unreadable, and rendering "" would look like "they left it blank".
  it("returns null for a position with no options to resolve it against", () => {
    expect(answerToText({ indexes: [1] }, null)).toBeNull();
    expect(answerToText({ indexes: [1] }, "not an array")).toBeNull();
  });

  it("returns null for an index outside the option list", () => {
    expect(answerToText({ indexes: [9] }, OPTS)).toBeNull();
  });

  it("keeps the readable half of a partly broken multi-select", () => {
    expect(answerToText({ indexes: [0, 9] }, OPTS)).toBe("6");
  });

  it("returns null for absent, empty and unreadable payloads", () => {
    expect(answerToText(null, OPTS)).toBeNull();
    expect(answerToText(undefined, OPTS)).toBeNull();
    expect(answerToText({}, OPTS)).toBeNull();
    expect(answerToText({ text: "   " }, OPTS)).toBeNull();
    expect(answerToText({ indexes: [] }, OPTS)).toBeNull();
  });

  it("never returns the literal [object Object]", () => {
    for (const shape of [{}, { indexes: {} }, { value: {} }, { text: {} }]) {
      const out = answerToText(shape, OPTS);
      expect(out === null || !out.includes("[object")).toBe(true);
    }
  });

  it("passes a bare string or number straight through", () => {
    expect(answerToText("True", OPTS)).toBe("True");
    expect(answerToText(7, OPTS)).toBe("7");
  });
});
