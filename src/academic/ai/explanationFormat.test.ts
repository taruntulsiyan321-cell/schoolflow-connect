import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_REASON_CHARS,
  MIN_WORKING_CHARS,
  WRONG_HEADING,
  composeExplanation,
  explanationShortfall,
  indexOfLetter,
  readExplanationParts,
} from "../../../supabase/functions/_shared/explanationFormat.ts";

/**
 * A proper explanation (owner, 2026-10-02): the answer, the working, and why
 * each wrong option is wrong. The database's explanation_is_proper
 * (20261138000000) decides what passes; this module writes the shape. These
 * tests hold the two together: the same thresholds, and the migration's own
 * fixture — which its proof shows the database accepting — is exactly what
 * this module writes from its parts.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261138000000_ai_practice_and_explanations_that_explain.sql"),
  "utf8",
);

/** The migration's E'…' fixture, as the string it is. */
function migrationFixture(): string {
  const m = MIGRATION.match(/_fixture constant text := E'((?:[^']|'')*)';/);
  if (!m) throw new Error("the migration's fixture is missing");
  return m[1].replace(/''/g, "'").replace(/\\n/g, "\n");
}

const OPTIONS = ["₹20,000", "₹30,000", "₹40,000", "No interest is payable"];
const PARTS = {
  working:
    "When there is no partnership deed, the Indian Partnership Act, 1932 applies. Section 13(d) allows interest on a partner's loan at 6% per annum, so the interest is ₹5,00,000 × 6/100 × 1 = ₹30,000.",
  wrong: [
    { index: 0, reason: "₹20,000 is interest at 4%; the Act fixes the rate at 6% per annum, not 4%." },
    { index: 2, reason: "₹40,000 is interest at 8%, a rate the Act does not provide for partners' loans." },
    { index: 3, reason: "Interest on a partner's loan is payable even without a deed; it is interest on capital that is not allowed." },
  ],
};

describe("the shape is the database's", () => {
  it("uses the thresholds explanation_is_proper uses", () => {
    expect(MIGRATION).toContain(`IF char_length(_working) < ${MIN_WORKING_CHARS} THEN`);
    expect(MIGRATION).toContain(`'\\) [^\\n]{${MIN_REASON_CHARS},}'`);
    expect(MIGRATION).toContain(`_heading constant text := E'\\n\\n${WRONG_HEADING}\\n'`);
  });

  it("writes, from its parts, exactly the fixture the migration proves proper", () => {
    expect(composeExplanation(OPTIONS, 1, PARTS)).toBe(migrationFixture());
  });

  it("puts the wrong options in order whatever order they came in", () => {
    const shuffled = { ...PARTS, wrong: [PARTS.wrong[2], PARTS.wrong[0], PARTS.wrong[1]] };
    expect(composeExplanation(OPTIONS, 1, shuffled)).toBe(migrationFixture());
  });
});

describe("a draft that falls short is refused, never padded", () => {
  it("a one-line working", () => {
    const thin = { ...PARTS, working: "Interest is 6% a year." };
    expect(explanationShortfall(OPTIONS, 1, thin)).toMatch(/working/);
    expect(composeExplanation(OPTIONS, 1, thin)).toBeNull();
  });

  it("a wrong option with no reason", () => {
    const missing = { ...PARTS, wrong: PARTS.wrong.slice(0, 2) };
    expect(explanationShortfall(OPTIONS, 1, missing)).toMatch(/option D/);
  });

  it("a reason too short to say anything", () => {
    const curt = { ...PARTS, wrong: [{ index: 0, reason: "Incorrect." }, ...PARTS.wrong.slice(1)] };
    expect(explanationShortfall(OPTIONS, 1, curt)).toMatch(/option A is too short/);
  });

  it("the right option listed as wrong, or an option that does not exist", () => {
    expect(explanationShortfall(OPTIONS, 1, { ...PARTS, wrong: [...PARTS.wrong, { index: 1, reason: "This is a reason that is long enough." }] }))
      .toMatch(/option B needs exactly one reason|listed as wrong/);
    expect(explanationShortfall(OPTIONS, 1, { ...PARTS, wrong: [...PARTS.wrong, { index: 5, reason: "This is a reason that is long enough." }] }))
      .toMatch(/does not have/);
  });

  it("control: the full draft has no shortfall", () => {
    expect(explanationShortfall(OPTIONS, 1, PARTS)).toBeNull();
  });
});

describe("reading a model's reply", () => {
  it("takes options by letter in any of the forms models write", () => {
    expect([indexOfLetter("B"), indexOfLetter("(c)"), indexOfLetter("D."), indexOfLetter("none"), indexOfLetter("AB")])
      .toEqual([1, 2, 3, null, null]);
    const parts = readExplanationParts({ working: "w", wrong: [{ option: "(A)", reason: "r" }, { index: 3, reason: "s" }, { option: "?", reason: "x" }] });
    expect(parts?.wrong).toEqual([{ index: 0, reason: "r" }, { index: 3, reason: "s" }]);
  });
});
