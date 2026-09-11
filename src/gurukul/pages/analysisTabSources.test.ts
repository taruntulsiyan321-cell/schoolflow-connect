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
import { stripComments } from "@/test/stripComments";

// RULE 29 — comments are stripped before matching. Every assertion below
// asserts ABSENCE, so a comment in Analysis.tsx explaining why the marks
// fetch was removed would name the very identifiers these forbid and fail a
// correct change. That happened twice already, over `examAvg`, in f6e2f51
// and 1ec1628. src/test/stripComments.test.ts is the control that the
// stripper actually runs; without it these assertions could pass vacuously.
const SOURCE = stripComments(readFileSync(join(__dirname, "Analysis.tsx"), "utf8"));

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

/**
 * G5 — one accuracy, derived from the counts shown beside it.
 *
 * The Overview tab rendered "13 correct · 14 incorrect · 46% accuracy" and the
 * arithmetic on display gave 48%. Three sources for one quantity on one screen:
 * `analysis.totals` for the counts, `student.accuracy` for the rate, and
 * `overallAccuracyFromSnapshot` — "the Test + practice blend" — inside the hook
 * that produced `totals.accuracy_pct`.
 *
 * The 10 September ruling settles it: practice supplies the detail, tests
 * supply marks only, and "the two are NEVER combined into one figure. No
 * average, no composite, no single performance score across both."
 *
 * These two assertions are the guard. Both can fail: putting the shell figure
 * back in the page breaks the first, and restoring the blend in the hook
 * breaks the second.
 */
describe("G5 — accuracy has one source", () => {
  const HOOK = stripComments(
    readFileSync(join(__dirname, "..", "..", "hooks", "useAnalysisPageData.ts"), "utf8"),
  );

  it("does not read the shell accuracy next to its own counts", () => {
    // `student.accuracy` is the Home/Progression figure. Rendered beside
    // `analysis.totals.correct` it disagrees with the division a student can do
    // in their head.
    expect(SOURCE).not.toContain("student.accuracy");
  });

  it("does not blend test marks into the Analysis accuracy", () => {
    expect(HOOK).not.toContain("overallAccuracyFromSnapshot");
  });

  it("derives it from correct and the attempt total instead", () => {
    // The positive half: asserting only the absences above would pass if the
    // figure stopped being computed at all.
    expect(HOOK).toContain("(100 * correct) / totalAttempts");
  });

  it("counts the SAME rows Home counts, not concept_mastery", () => {
    // Home's figure is `_exam_readiness.practice_accuracy_pct`, which is
    // `100 * correct / count` over `question_attempts`. Analysis used to sum
    // `concept_mastery`, which has drifted from the attempt record it derives
    // from — measured on one student: 120 real attempts / 20 correct = 17%,
    // against concept_mastery's 200 / 125 = 63%. Not a subset. Not a window.
    // A 46-point disagreement about one child on two screens.
    expect(HOOK).toContain('from("question_attempts")');
    expect(HOOK).not.toContain("rpc_student_concept_mastery");
  });

  it("does not fall back to practice_sessions.correct_count", () => {
    // That column is seeded on 240 of 244 rows and disagrees with its own
    // attempts (KNOWN_ISSUES 44), so a fallback to it reintroduces the same
    // class of error by another route.
    expect(HOOK).not.toContain("s + x.correct_count");
  });
});
