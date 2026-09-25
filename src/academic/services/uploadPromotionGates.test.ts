/**
 * §10.2 promotion gates — four negatives (one per gate) and one positive.
 * Binding: docs/custom-practice-upload-spec.md §12.5
 */
import { describe, expect, it } from "vitest";
import {
  canPromote,
  type UploadPromotionInput,
} from "./uploadPromotionGates";

const passing: UploadPromotionInput = {
  chapterId: "chapter-uuid-1",
  options: ["A", "B", "C", "D"],
  correctIndex: 1,
  explanation: "Because B is the only right answer.",
  isNearDup: false,
  answerSource: "file",
};

describe("canPromote — §10.2", () => {
  it("promotes when all four gates pass", () => {
    expect(canPromote(passing)).toBe(true);
  });

  it("refuses when chapter_id is missing (§10.2.1)", () => {
    expect(canPromote({ ...passing, chapterId: null })).toBe(false);
    expect(canPromote({ ...passing, chapterId: "   " })).toBe(false);
  });

  it("refuses when the variant does not validate (§10.2.2)", () => {
    expect(canPromote({ ...passing, options: null })).toBe(false);
    expect(canPromote({ ...passing, options: [] })).toBe(false);
    expect(canPromote({ ...passing, correctIndex: null })).toBe(false);
    expect(canPromote({ ...passing, correctIndex: 9 })).toBe(false);
    expect(canPromote({ ...passing, explanation: null })).toBe(false);
    expect(canPromote({ ...passing, explanation: "  " })).toBe(false);
  });

  it("refuses a near-duplicate (§10.2.3)", () => {
    expect(canPromote({ ...passing, isNearDup: true })).toBe(false);
  });

  it("refuses when the source was AI-answered (§10.2.4)", () => {
    expect(canPromote({ ...passing, answerSource: "ai" })).toBe(false);
  });
});
