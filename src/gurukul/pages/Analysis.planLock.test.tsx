/**
 * TOPIC-WISE ANALYSIS IS IN THE PLAN (20261112000000).
 *
 * For a plan without it, the server sends weak_topics and by_topic empty with
 * topic_analysis_locked. An empty list there is not "nothing flagged yet" —
 * the page says the plan does not cover it, on every panel that reads topics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

const state = vi.hoisted(() => ({ locked: true }));

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
    data: { totals: { correct: 0, wrong: 0, skipped: 0, accuracy_pct: null }, recent_sessions: [] },
    loading: false, error: null,
  }),
}));
// The hour histogram moved out of useAnalysisPageData into its own hook
// (20261115000000). Unmocked it fetches, the page stays in its skeleton, and
// no tab is on screen to click.
vi.mock("@/hooks/useStudentPracticeTime", () => ({
  useStudentPracticeTime: () => ({
    data: { from: "2026-08-01", today: "2026-09-29", days: [], hours: new Array(24).fill(0) },
    loading: false, error: null, reload: () => {},
  }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({
    data: { mistake_count: 0, recovery_pending: 0, weak_topics: [], activity_heatmap: [], ...(state.locked ? { topic_analysis_locked: true } : {}) },
    loading: false, error: null,
  }),
}));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({
    data: {
      by_subject: [], by_chapter: [], by_topic: [], by_difficulty: [], recurring: [],
      effort: { attempts: 0, repeat_attempts: 0, first_try_attempts: 0, first_try_correct: 0 },
      topic_analysis_locked: state.locked,
    },
    loading: false, error: null,
  }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
import Analysis from "./Analysis";

const LOCKED = "Topic-wise analysis is not in your plan.";
const show = () => render(<MemoryRouter><Analysis /></MemoryRouter>);
/** The tab bar is role=tablist / role=tab, not plain buttons. */
const openTab = (label: string) => fireEvent.click(screen.getByRole("tab", { name: label }));
/** The plan notices on screen (PlanLimitNotice is role=status). */
const lockNotices = () => screen.queryAllByRole("status").filter((el) => el.textContent?.includes(LOCKED));

beforeEach(() => { state.locked = true; });

describe("Analysis — topic-wise analysis outside the plan", () => {
  it("the Topics tab says the plan does not cover it, not that nothing is flagged", () => {
    show();
    openTab("Topics");
    expect(lockNotices()).toHaveLength(1);
    expect(screen.queryByText(/Nothing flagged yet/)).toBeNull();
    const practised = screen.getByText("Topics practised").parentElement as HTMLElement;
    expect(practised.textContent).toContain("—");
    const attention = screen.getByText("Need attention").parentElement as HTMLElement;
    expect(attention.textContent).toContain("—");
  });

  it("the time-per-topic card says so too", () => {
    show();
    openTab("Activity & Speed");
    const card = screen.getByText("Topics that take you longest (seconds per answer)").closest("div")!.parentElement as HTMLElement;
    expect(card.textContent).toContain(LOCKED);
    expect(lockNotices()).toHaveLength(1);
    expect(card.textContent).not.toMatch(/No topic has \d+ answered/);
  });

  it("the improve card does not claim no weak topics", () => {
    show();
    expect(document.body.textContent).not.toContain("No weak topics flagged yet");
    expect(document.body.textContent).toContain(LOCKED);
  });

  it("CONTROL: with topic analysis in the plan, an empty list reads as empty", () => {
    state.locked = false;
    show();
    expect(document.body.textContent).not.toContain(LOCKED);
    openTab("Topics");
    expect(lockNotices()).toHaveLength(0);
    expect(screen.getByText(/Nothing flagged yet/)).toBeInTheDocument();
    const practised = screen.getByText("Topics practised").parentElement as HTMLElement;
    expect(practised.textContent).toContain("0");
  });
});
