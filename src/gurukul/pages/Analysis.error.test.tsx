import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * WHAT A STUDENT SEES WHEN ANALYSIS CANNOT LOAD.
 *
 * The banner used to end "Showing available stats as zeros where missing",
 * which is the opposite of what the page does and instructs the reader to
 * make exactly the misreading every null-handling fix on this page exists to
 * prevent. It also offered nothing to press: all four hooks expose reload()
 * and none was wired, so a transient failure meant navigating away and back.
 *
 * A retry that re-renders but never re-fetches looks identical to a working
 * one in a screenshot and identical to a working one to tsc, so this asserts
 * the loaders RAN AGAIN — all four of them, because loadError is the first
 * non-null of four and the others are just as likely to be down.
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

const reloadAnalysis = vi.fn();
const reloadCharts = vi.fn();
const reloadSnapshot = vi.fn();
const reloadAnalytics = vi.fn();

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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

vi.mock("@/hooks/useAnalysisPageData", () => ({
  useAnalysisPageData: () => ({
    data: { totals: { correct: 0, wrong: 0, skipped: 0, accuracy_pct: null }, recent_sessions: [], attempt_hours: new Array(24).fill(0) },
    loading: false,
    error: "practice attempts are unavailable",
    reload: reloadAnalysis,
  }),
}));
vi.mock("@/hooks/useStudentPerformanceCharts", () => ({
  useStudentPerformanceCharts: () => ({ data: null, loading: false, error: null, reload: reloadCharts }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: null, loading: false, error: null, reload: reloadSnapshot }),
}));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({ data: null, loading: false, error: null, reload: reloadAnalytics }),
}));

import Analysis from "./Analysis";

describe("Analysis — a load that failed", () => {
  it("names the failure instead of telling the student to read dashes as zeros", () => {
    render(<Analysis />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("practice attempts are unavailable");
    expect(text).toContain("shown as");
    expect(text).not.toContain("as zeros where missing");
  });

  it("re-runs every loader when Try again is pressed", () => {
    reloadAnalysis.mockClear();
    reloadCharts.mockClear();
    reloadSnapshot.mockClear();
    reloadAnalytics.mockClear();
    render(<Analysis />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // All four, not just the one whose error happened to surface.
    expect(reloadAnalysis).toHaveBeenCalledTimes(1);
    expect(reloadCharts).toHaveBeenCalledTimes(1);
    expect(reloadSnapshot).toHaveBeenCalledTimes(1);
    expect(reloadAnalytics).toHaveBeenCalledTimes(1);
  });

  it("still renders the page rather than blanking it", () => {
    render(<Analysis />);
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    // And invents nothing to fill the gap.
    expect(document.body.textContent).not.toContain("0%");
  });
});
