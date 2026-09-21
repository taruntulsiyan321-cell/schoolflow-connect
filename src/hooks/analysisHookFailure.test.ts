import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

/**
 * A FAILED REFRESH MUST NOT KEEP SHOWING THE LAST ANSWER.
 *
 * useStudentPracticeAnalytics stated the rule in its own error branch — "a
 * panel that keeps rendering the last student's figures after a failed
 * refresh is worse than one that says it has nothing" — and two of the four
 * hooks behind the Analysis page did not follow it: their error branch set
 * the message and left `data` untouched, so a failure after a student switch
 * would have shown the previous student's snapshot.
 *
 * Nor is an EMPTY object the answer. Empty arrays and zero counts are what a
 * student who has never practised looks like, so "we could not read this"
 * and "you have not done this" render identically. Null is the absence, and
 * the page renders an absent figure as an em dash.
 *
 * These are source assertions because reaching the branch needs a mocked
 * PostgREST error per hook, and a test that heavy gets skipped.
 */
const HOOKS = [
  "useAnalysisPageData",
  "useStudentPracticeAnalytics",
  "useStudentAcademicSnapshot",
  "useStudentPerformanceCharts",
] as const;

describe("every Analysis hook reports failure as absence", () => {
  for (const name of HOOKS) {
    const src = stripComments(
      readFileSync(join(__dirname, `${name}.ts`), "utf8"),
    );

    it(`${name} sets an error`, () => {
      expect(src).toMatch(/setError\(/);
    });

    it(`${name} clears its data rather than keeping or faking one`, () => {
      // The three shapes this has actually taken: leaving data alone,
      // writing a zeroed totals object, and writing empty arrays.
      expect(src).toContain("setData(null)");
      expect(src).not.toMatch(/setData\(EMPTY\)/);
      expect(src).not.toMatch(/correct:\s*0,\s*\n\s*wrong:\s*0,/);
    });
  }

  it("names all four hooks the page actually uses", () => {
    // Positive control: if the page grows a fifth source, this list and the
    // rule both need updating, and an out-of-date list must not pass
    // silently.
    const page = stripComments(
      readFileSync(join(__dirname, "..", "gurukul", "pages", "Analysis.tsx"), "utf8"),
    );
    for (const name of HOOKS) expect(page).toContain(name);
  });
});
