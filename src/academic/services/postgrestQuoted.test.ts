import { describe, expect, it } from "vitest";
import { postgrestQuoted } from "./practiceService";

describe("postgrestQuoted — a label inside or=(…)/in.(…) stays one value", () => {
  it("wraps a comma-bearing chapter so PostgREST cannot split it", () => {
    // The live defect: unquoted, this chapter's filter was DROPPED and a
    // session reached 2 of its 40 questions.
    expect(postgrestQuoted("Gender, Religion and Caste")).toBe('"Gender, Religion and Caste"');
    expect(`chapter.ilike.${postgrestQuoted("Acids, Bases and Salts")}`).toBe('chapter.ilike."Acids, Bases and Salts"');
  });

  it("keeps parentheses literal", () => {
    expect(postgrestQuoted("Motion (Kinematics)")).toBe('"Motion (Kinematics)"');
  });

  it("escapes a quote and a backslash instead of dropping them", () => {
    expect(postgrestQuoted('say "hi"')).toBe('"say \\"hi\\""');
    expect(postgrestQuoted("a\\b")).toBe('"a\\\\b"');
  });
});
