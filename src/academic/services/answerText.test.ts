import { describe, it, expect } from "vitest";
import { answerToIndex, answerToIndexes } from "./answerText";

const OPTS = ["6", "9", "12"];

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
