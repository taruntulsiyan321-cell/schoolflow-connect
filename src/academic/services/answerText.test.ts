import { describe, it, expect } from "vitest";
import { answerToText, answerToIndex, answerToIndexes } from "./answerText";

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

describe("answerToIndex — the shape practice actually writes", () => {
  // The regression this file exists to stop repeating. student_mistakes rows
  // written by practice carry { index, text }; every reader looked for
  // `correct_index`, found nothing, and treated the answer as unknown. In the
  // Mistake Book that made every retry answer wrong, so no entry could ever be
  // cleared and no chapter could leave relearn.
  it("reads `index`, which 58 of 67 practisable mistake rows use", () => {
    // No `text` here on purpose. With one, the word fallback resolves the
    // answer and the assertion passes whether or not `index` is read at all —
    // the first version of this test did exactly that and stayed green with
    // the `index` branch deleted.
    expect(answerToIndex({ index: 1 }, OPTS)).toBe(1);
    expect(answerToText({ index: 1 }, OPTS)).toBe("9");
  });

  it("takes the position over a word that disagrees with it", () => {
    // text says "6" (position 0), index says 1. The position is the answer.
    expect(answerToIndex({ index: 1, text: "6" }, OPTS)).toBe(1);
  });

  it("still reads every older shape", () => {
    expect(answerToIndex({ indexes: [2] }, OPTS)).toBe(2);
    expect(answerToIndex({ correct_index: 0 }, OPTS)).toBe(0);
    expect(answerToIndex({ selected_index: 2 }, OPTS)).toBe(2);
  });

  it("resolves a bare option letter against the list", () => {
    expect(answerToIndex("C", OPTS)).toBe(2);
    expect(answerToIndex("a", OPTS)).toBe(0);
  });

  it("prefers an option whose text IS the letter over the letter as a label", () => {
    expect(answerToIndex("B", ["A", "B", "C"])).toBe(1);
  });

  it("resolves an answer given as its own words", () => {
    expect(answerToIndex({ text: "12" }, OPTS)).toBe(2);
    expect(answerToIndex("9", OPTS)).toBe(1);
  });

  it("refuses to guess rather than returning position 0", () => {
    expect(answerToIndex(null, OPTS)).toBeNull();
    expect(answerToIndex({}, OPTS)).toBeNull();
    expect(answerToIndex({ text: "not an option" }, OPTS)).toBeNull();
    // Out of range is a broken row, not option A.
    expect(answerToIndex({ index: 9 }, OPTS)).toBeNull();
    // No option list to resolve a word against.
    expect(answerToIndex("C", null)).toBeNull();
  });

  it("returns every position of a multi-select", () => {
    expect(answerToIndexes({ indexes: [0, 2] }, OPTS)).toEqual([0, 2]);
  });
});
