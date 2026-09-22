/**
 * THE STUDENT WHO HAS DONE NOTHING YET.
 *
 * Every "0%" defect this page has been corrected for is the same mistake: an
 * absent measurement rendered as a confident zero. A student with no practice
 * behind them is the case that surfaces all of them at once, and it is the
 * case a fixture full of real data can never reach.
 *
 * The rule the page holds, and this file enforces: NOTHING RECORDED RENDERS
 * AS AN EM DASH, never as 0, 0%, 0m or "0 min". A real zero — zero activities
 * in a month that had activity, zero correct out of twenty answered — is a
 * measurement and still shows as zero. The difference is whether there was
 * anything to measure.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT } = await import("@/gurukul/emptyStudent");
  const value = { ...EMPTY_STUDENT };
  return { useGurukulStudent: () => value };
});
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "s", userId: "u", role: "student", studentId: "st" }, ready: true, studentId: "st", classId: "c" };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic", () => ({
  useAcademicLive: () => 0,
  RecoveryEngineService: { getChapterStates: () => Promise.resolve([]), getRecoveryQueue: () => Promise.resolve([]) },
}));
vi.mock("@/academic/services/decisionEngineService", () => ({
  DecisionEngineService: { getWeakAreasV2: () => Promise.resolve([]) },
}));
vi.mock("@/hooks/useAnalysisPageData", () => ({
  useAnalysisPageData: () => ({
    data: { totals: { correct: 0, wrong: 0, skipped: 0, accuracy_pct: null }, recent_sessions: [], attempt_hours: new Array(24).fill(0) },
    loading: false, error: null,
  }),
}));
vi.mock("@/hooks/useStudentPerformanceCharts", () => ({
  useStudentPerformanceCharts: () => ({ data: { practice_trend: [], weekly_activity: [] }, loading: false, error: null }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: { mistake_count: 0, recovery_pending: 0, weak_topics: [], activity_heatmap: [] }, loading: false, error: null }),
}));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({
    data: { by_subject: [], by_chapter: [], by_topic: [], by_difficulty: [], effort: { attempts: 0, solution_viewed: 0, repeat_attempts: 0, first_try_attempts: 0, first_try_correct: 0 }, recurring: [] },
    loading: false, error: null,
  }),
}));
import Analysis from "./Analysis";

describe("Analysis — a student with no practice at all", () => {
  const openTab = (label: string) =>
    fireEvent.click(screen.getByRole("button", { name: label }));

  it("renders every tab without throwing", () => {
    render(<Analysis />);
    for (const t of ["Overview", "Subjects & Chapters", "Topics", "Practice", "Activity & Speed", "Milestones & Reports"]) {
      openTab(t);
      expect(screen.getByText("Analysis")).toBeInTheDocument();
    }
  });

  it("claims no accuracy it cannot measure", () => {
    render(<Analysis />);
    // Correct 0 and Incorrect 0 are real counts. The RATE over them does not
    // exist, and "0%" would say the student got everything wrong.
    expect(document.body.textContent).not.toContain("0%");
    expect(document.body.textContent).not.toContain("0% accuracy");
  });

  it("claims no study time it never recorded", () => {
    render(<Analysis />);
    openTab("Activity & Speed");
    const text = document.body.textContent ?? "";
    // "Average per day: 0 min" sat beside "Study time (4 weeks): —" — the
    // same absence rendered two ways in one row of tiles.
    expect(text).not.toContain("0 min");
    expect(text).not.toContain("0m");
    expect(text).not.toContain("0h");
  });

  it("reports an empty month as empty, not as zeroes", () => {
    render(<Analysis />);
    openTab("Activity & Speed");
    const panel = screen.getByText("This month vs last month").parentElement as HTMLElement;
    // Activities and Study time returned 0 while Accuracy returned null, so
    // one absent month printed two confident zeroes and one honest dash.
    expect(panel.textContent).not.toMatch(/Activities\s*0/);
  });

  it("offers a first milestone instead of an empty screen", () => {
    render(<Analysis />);
    openTab("Milestones & Reports");
    expect(screen.getByText(/Solve 100 practice questions/)).toBeInTheDocument();
  });

  it("names no fastest or slowest subject", () => {
    render(<Analysis />);
    openTab("Practice");
    const fastest = screen.getByText("Fastest subject").parentElement as HTMLElement;
    expect(fastest.textContent).toContain("\u2014");
    expect(fastest.textContent).not.toContain("0s");
  });

  it("uses one spelling of practise throughout", () => {
    render(<Analysis />);
    for (const t of ["Topics", "Milestones & Reports"]) {
      openTab(t);
      expect(document.body.textContent).not.toContain("practicing");
      expect(document.body.textContent).not.toContain("practiced");
    }
  });
});
