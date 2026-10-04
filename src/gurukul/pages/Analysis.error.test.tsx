import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
// The page links into Practice and Mistake Types, as the app renders it: inside the router.
import { MemoryRouter } from "react-router-dom";

/**
 * WHAT A STUDENT SEES WHEN ANALYSIS CANNOT LOAD.
 *
 * The banner used to end "Showing available stats as zeros where missing",
 * which is the opposite of what the page does and instructs the reader to
 * make exactly the misreading every null-handling fix on this page exists to
 * prevent. It also offered nothing to press: every hook exposes reload()
 * and none was wired, so a transient failure meant navigating away and back.
 *
 * A retry that re-renders but never re-fetches looks identical to a working
 * one in a screenshot and identical to a working one to tsc, so this asserts
 * the loaders RAN AGAIN — all five of them, because loadError is the first
 * non-null of five and the others are just as likely to be down.
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

const reloadAnalysis = vi.fn();
const reloadSnapshot = vi.fn();
const reloadAnalytics = vi.fn();
const reloadPracticeTime = vi.fn();

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
    // What the hook actually does on a failure now: null, not a zeroed
    // totals object that reads as "this student has answered nothing".
    data: null,
    loading: false,
    error: "practice attempts are unavailable",
    reload: reloadAnalysis,
  }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: null, loading: false, error: null, reload: reloadSnapshot }),
}));
vi.mock("@/hooks/useStudentPracticeTime", () => ({
  useStudentPracticeTime: () => ({ data: null, loading: false, error: null, reload: reloadPracticeTime }),
}));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({ data: null, loading: false, error: null, reload: reloadAnalytics }),
}));

import Analysis from "./Analysis";

describe("Analysis — a load that failed", () => {
  it("names the failure instead of telling the student to read dashes as zeros", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).toContain("practice attempts are unavailable");
    expect(text).toContain("shown as");
    expect(text).not.toContain("as zeros where missing");
  });

  it("re-runs every loader when Try again is pressed", () => {
    reloadAnalysis.mockClear();
    reloadSnapshot.mockClear();
    reloadAnalytics.mockClear();
    reloadPracticeTime.mockClear();
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // All four, not just the one whose error happened to surface.
    expect(reloadAnalysis).toHaveBeenCalledTimes(1);
    expect(reloadSnapshot).toHaveBeenCalledTimes(1);
    expect(reloadAnalytics).toHaveBeenCalledTimes(1);
    expect(reloadPracticeTime).toHaveBeenCalledTimes(1);
  });

  it("still renders the page rather than blanking it", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    // And invents nothing to fill the gap. "Questions solved 0 · Correct 0
    // · Incorrect 0" under a banner saying the data could not be read is a
    // claim about the student, not an absence.
    expect(document.body.textContent).not.toContain("0%");
    const solved = screen.getByText("Questions solved").parentElement as HTMLElement;
    expect(solved.textContent).toContain("\u2014");
    expect(solved.textContent).not.toContain("0");
    const correct = screen.getByText("Correct answers").parentElement as HTMLElement;
    expect(correct.textContent).toContain("\u2014");
  });

  it("reads an unread day list as unknown on the Practice tab, not as a month of zeroes", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
    for (const label of ["Practice today", "Practice in 4 weeks", "Consistency"]) {
      const tile = screen.getByText(label).parentElement as HTMLElement;
      expect(tile.textContent, label).toContain("\u2014");
      expect(tile.textContent, label).not.toMatch(/\b0%?$/);
    }
    expect(screen.queryByText("No monthly activity yet")).toBeNull();
    expect(screen.getAllByText("Your practice days could not be read.").length).toBeGreaterThan(0);
  });
});
