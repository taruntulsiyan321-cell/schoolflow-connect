/**
 * RULE 11 — Analysis is fed by practice and by nothing else.
 *
 * The rule was tightened on 2026-09-05. It used to be per-tab: keep test data
 * out of the `practice` tab, and give marks their own tab plus a fetch gated on
 * `TABS_NEEDING_MARKS`. That gate is gone, because the question is no longer
 * "which tabs may read marks" but "none of them".
 *
 * So these assertions moved up a level. They no longer ask where the marks
 * query is allowed to fire; they assert the query does not exist.
 *
 * ── WHY THESE ARE SOURCE ASSERTIONS ───────────────────────────────────────
 *
 * Rendering Analysis needs a live academic context, a student, a class and four
 * RPCs. A test that heavy gets skipped, and a skipped test leaves the rule
 * unguarded. Reading the file cannot be skipped and cannot pass for the wrong
 * reason.
 *
 * G11 — every assertion below can fail. Restoring the marks fetch, the exam
 * join, the `marks` tab, or the `examAvg ?? accuracy` blend each breaks a
 * named one, and the fifth breaks if the page is emptied to satisfy the rest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABS, type Tab } from "./analysisTabs";

const SOURCE = readFileSync(join(__dirname, "Analysis.tsx"), "utf8");

describe("rule 11 — Analysis touches practice tables only", () => {
  it("issues no query against marks or exams", () => {
    // MarksService is the only route to either table from this page.
    expect(SOURCE).not.toContain("MarksService");
    expect(SOURCE).not.toContain("listExamsForClass");
  });

  it("carries no binding derived from marks or exams", () => {
    for (const binding of ["testResults", "testTrend", "testTrendDomain", "marksQuery"]) {
      expect(SOURCE.includes(binding), `${binding} is marks-derived and must not be here`).toBe(
        false,
      );
    }
  });

  it("does not subscribe to the marks or examination live channels", () => {
    // Subscribing is a read intent even when nothing is drawn from it.
    expect(SOURCE).not.toMatch(/useAcademicLive\(\[[^\]]*["'](marks|examination)["']/);
  });

  it("has no marks tab left to render", () => {
    const keys = TABS.map((t) => t.key) as string[];
    expect(keys).not.toContain("marks");
    expect(SOURCE).not.toContain('tab === "marks"');
  });

  it("keeps the practice surface, so the rule is not satisfied by emptying the page", () => {
    // The opposite failure: a page that reads nothing passes "practice only"
    // trivially. A rule enforced by breaking the feature is not enforced.
    const keys = TABS.map((t) => t.key) as string[];
    expect(keys).toContain("practice");
    expect(SOURCE).toContain('tab === "practice"');
    expect(SOURCE).toContain("useConceptMastery");
    expect(SOURCE).toContain("useStudentPerformanceCharts");
  });

  it("blends no two rates into one field (§4.2b)", () => {
    // `overview.avgScore` was `examAvg ?? accuracy`: an exam average for a
    // student with marks, a practice accuracy for one without, with a sibling
    // boolean as the only way to tell which of the two you were reading.
    expect(SOURCE).not.toContain("examAvg");
    expect(SOURCE).not.toContain("avgScoreIsExam");
  });

  it("does not describe the ephemeral test report, which has never existed", () => {
    // A JSX comment here called it a shipped distinction. No code has ever
    // existed for it, and the phrase helped two sessions treat the parked
    // rules 12-15 as binding.
    expect(SOURCE).not.toMatch(/ephemeral test report/i);
  });

  it("the tab is no longer labelled for tests", () => {
    expect(SOURCE).not.toContain('label: "Practice & Tests"');
  });
});

describe("the tab list itself", () => {
  it("has a unique key per tab and a label for each", () => {
    const keys = TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TABS) expect(t.label.length).toBeGreaterThan(0);
  });

  it("declares exactly the six practice-derived tabs", () => {
    const expected: Tab[] = [
      "overview",
      "subjects",
      "topics",
      "practice",
      "activity",
      "milestones",
    ];
    expect(TABS.map((t) => t.key)).toEqual(expected);
  });
});
