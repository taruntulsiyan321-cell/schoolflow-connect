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
    // NAMED SOURCES, and they changed. This asserted `useConceptMastery`,
    // which is exactly the trap a guard written against an implementation
    // falls into: concept_mastery was removed from this page deliberately —
    // it is a DERIVED table already caught disagreeing with the attempts it is
    // built from — and the guard then failed a correct change.
    //
    // What the guard is for is that the page still reads real practice data,
    // so it names the hooks that carry it now. It still fails if they go.
    expect(SOURCE).toContain("useStudentPracticeAnalytics");
    expect(SOURCE).toContain("useStudentPerformanceCharts");
    expect(SOURCE).toContain("useAnalysisPageData");
  });

  it("reads no attendance, which practice does not produce", () => {
    // The last school-data figure on a practice-only page. It was a measured
    // number, which made it honest but not relevant: a student reading their
    // practice analysis cannot act on their attendance here, and their
    // attendance surface already shows it.
    expect(SOURCE).not.toContain("attendance_pct");
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

/**
 * §6.7 / §10.16 — THIS PAGE IS ABOUT ONE STUDENT AND NOBODY ELSE.
 *
 * Analysis shows a child their own record. It does not show them the class,
 * the school, an average, a rank or a percentile, and it does not reach for a
 * row belonging to anyone else in order to say something about them. The
 * page already obeyed this; nothing asserted it, so the next person to add a
 * "how you compare" panel would have found no resistance.
 *
 * peerBenchmarkSubjects existed in this page's own helper module until
 * 2026-09-21 — unused, but still carrying `_rank` and `_classSize`
 * parameters from a percentile it had been corrected out of. That is how the
 * comparison gets back in: not as a decision, as a leftover.
 */
describe("§6.7 — Analysis reads one student and never a cohort", () => {
  it("names no cohort, rank or percentile anywhere in the page", () => {
    for (const token of [
      "peer",
      "percentile",
      "classmate",
      "cohort",
      "leaderboard",
      "classAverage",
      "class_average",
      "topper",
    ]) {
      expect(SOURCE.includes(token), `${token} is a comparison against other students`).toBe(
        false,
      );
    }
  });

  it("scopes nothing by school or class", () => {
    // Every query behind this page filters on the signed-in user — directly
    // via user_id, or inside an RPC on auth.uid(). A school_id or class_id
    // filter here would be a query about a group.
    expect(SOURCE).not.toContain("school_id");
    expect(SOURCE).not.toContain("class_id");
  });

  it("still reads the student's own record, so the rule is not met by showing nothing", () => {
    expect(SOURCE).toContain("useStudentAcademicSnapshot");
    expect(SOURCE).toContain("subjectData");
  });
});

/**
 * G9 — ONE CLOCK. Per-question time has a single definition on this page.
 *
 * deriveSpeedStats measured it as a SESSION's total_time_ms / question_count,
 * which counts the gaps between questions, while the topic and chapter
 * panels on the Activity tab read question_attempts.time_taken_ms, which does
 * not. Both were rendered. "Takes most time: Mathematics" and "Chapters that
 * take you longest" were answering one question from two different clocks,
 * and nothing made them agree.
 *
 * It also had no evidence floor at all: fastest and slowest subject were the
 * first and last of an unfiltered sort, so one timed question could name the
 * subject a student is slowest at.
 */
describe("G9 — per-question time has one definition", () => {
  it("does not measure pace from session totals", () => {
    expect(SOURCE).not.toContain("deriveSpeedStats");
    expect(SOURCE).not.toContain("speedBySubject");
  });

  it("measures it from the attempt record, through the floored helper", () => {
    expect(SOURCE).toContain("deriveSubjectPace");
    expect(SOURCE).toContain("subjectPace");
  });

  it("does not sum the heat-map raw behind a label that says four weeks", () => {
    // Study time, average per day, most active day and the day-of-week bars
    // all say "last 4 weeks" and all used to reduce over whatever span the
    // snapshot returned. They read activityWeeks now, which consistencyWeeks
    // windows, so the label and the arithmetic cannot drift apart.
    expect(SOURCE).not.toContain("activity_heatmap ?? []");
    expect(SOURCE).toContain("consistencyWeeks(snapshot?.activity_heatmap, 4)");
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

  it("does not take its headline accuracy from exam_readiness", () => {
    // The page header printed "Practice accuracy" from
    // practiceAccuracyFromSnapshot — exam_readiness.practice_accuracy_pct —
    // directly above an Overview tile computing the same rate from
    // analysis.totals. Two pipelines, one label, agreeing only by luck.
    //
    // And that helper falls back to exam_readiness.accuracy_pct, which is the
    // TEST + PRACTICE BLEND, so a page that issues no marks query could still
    // print a number containing exam marks under a label that says practice
    // (§4.2b, rule 11). It reads overview.accuracy now.
    expect(SOURCE).not.toContain("practiceAccuracyFromSnapshot");
    expect(SOURCE).not.toContain("exam_readiness");
  });

  it("does not blend test marks into the Analysis accuracy", () => {
    expect(HOOK).not.toContain("overallAccuracyFromSnapshot");
  });

  it("derives it from correct and the attempt total instead", () => {
    // The positive half: asserting only the absences above would pass if the
    // figure stopped being computed at all.
    // It is now correct / (correct + wrong), via the named accuracyOverAnswered.
    //
    // totalAttempts INCLUDES SKIPPED questions, and skips stopped being counted
    // as wrong answers on 2026-09-15. Dividing a skip-free numerator by a
    // skip-inclusive denominator put three tiles on one row that do not add up:
    // measured live at 10 correct, 14 incorrect, "36%", where 10 of 24 is 42%.
    // That is the very defect this file exists to prevent, so the guard moves
    // to the corrected rule rather than being deleted.
    expect(HOOK).toContain("accuracyOverAnswered(correct, wrong)");
    expect(HOOK).toContain("(100 * correct) / answered");
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
