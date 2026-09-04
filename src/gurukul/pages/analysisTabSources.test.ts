/**
 * RULE 11 — the practice tab is fed by practice and nothing else.
 *
 * The defect this locks: `testResults` and a test-score trend rendered inside
 * the tab named `practice`, and marks/exams loaded at PAGE level so the query
 * fired no matter which tab was open. Rendering nothing is not the same as
 * fetching nothing — a surface that issues a query against a test table is
 * touching test data whether or not it draws it.
 *
 * Two assertions, because the defect had two halves:
 *   1. the fetch is not gated on a tab that includes `practice`
 *   2. the practice BLOCK in the source references no test-derived binding
 *
 * The second is a source assertion rather than a render assertion on purpose.
 * Rendering Analysis needs a live academic context, a student, a class and four
 * RPCs; a test that heavy would be skipped and the rule would go unguarded.
 * Reading the file cannot be skipped and cannot pass for the wrong reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABS_NEEDING_MARKS } from "./analysisTabs";

const SOURCE = readFileSync(join(__dirname, "Analysis.tsx"), "utf8");

/** The bindings derived from marks and exams. None may appear under `practice`. */
const TEST_DERIVED = ["testResults", "testTrend", "testTrendDomain", "marksQuery"];

function practiceTabBlock(src: string): string {
  const start = src.indexOf('{tab === "practice" && (');
  expect(start, 'the practice tab block was not found — has it been renamed?').toBeGreaterThan(-1);
  // The next sibling tab opens the block that follows.
  const end = src.indexOf('{tab === "', start + 24);
  expect(end, "no tab follows practice; the range would run to end of file").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("rule 11 — the practice surface touches practice tables only", () => {
  it("does not fetch marks or exams while the practice tab is open", () => {
    expect(TABS_NEEDING_MARKS).not.toContain("practice");
  });

  it("still fetches them where marks legitimately belong", () => {
    // Guards the opposite failure: gating so hard that the marks history tab
    // renders empty. A rule enforced by breaking the feature is not enforced.
    expect(TABS_NEEDING_MARKS).toContain("marks");
    expect(TABS_NEEDING_MARKS).toContain("overview");
  });

  it("renders no test-derived value inside the practice tab", () => {
    const block = practiceTabBlock(SOURCE);
    for (const binding of TEST_DERIVED) {
      expect(block.includes(binding), `practice tab references "${binding}"`).toBe(false);
    }
  });

  it("the practice block is real, so the assertion above cannot pass on an empty string", () => {
    // G11: the check must be able to fail. If the slice were empty every
    // `includes` would return false and the test would pass having read nothing.
    const block = practiceTabBlock(SOURCE);
    expect(block.length).toBeGreaterThan(500);
    expect(block).toContain("practiceStats");
  });

  it("the tab is no longer labelled for tests", () => {
    expect(SOURCE).not.toContain('label: "Practice & Tests"');
  });
});
