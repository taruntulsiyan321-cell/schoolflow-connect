/**
 * Analysis reads the recovery and revision engine as a list that is loading,
 * failed, or read — and counts each figure where the engine keeps it.
 *
 * Measured 2026-09-22, driving the page as a student:
 *   · a failed or slow schedule read rendered "Nothing due for revision today"
 *     and "No recovery topics yet" — claims made by a network failure;
 *   · "Recovered" was counted from the recovery queue, which a passing
 *     recovery LEAVES (it clears the chapter's open mistakes), so a recovered
 *     chapter with nothing open never counted;
 *   · a high-accuracy chapter wore a green "Ready for revision" badge — a
 *     strength verdict (§6.1, §10.8) naming a schedule it had nothing to do with;
 *   · "Suggested priority today" read the raw weak-topic list the Topics tab
 *     filters, so it could name a topic with one attempt behind it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

const engine = vi.hoisted(() => ({ getChapterStates: vi.fn(), getRecoveryQueue: vi.fn() }));
const ahead = (n: number) => new Date(Date.now() + n * 864e5).toISOString();

const RECOVERED_AND_CLEAR = {
  chapter_id: "c1", chapter: "Algebra", subject: "Mathematics", state: "recovered", revision_stage: 1,
  consecutive_passes: 0, next_revision_at: ahead(7), revision_due: false, recovered_at: ahead(-1),
  last_recovery_readiness: 0.9, open_mistakes: 0, revision_fresh_available: 8,
};
const IN_RECOVERY = {
  chapter_id: "c3", chapter: "Circles", subject: "Mathematics", state: "in_recovery", revision_stage: 0,
  consecutive_passes: 0, next_revision_at: null, revision_due: false, recovered_at: null,
  last_recovery_readiness: null, open_mistakes: 4, revision_fresh_available: 0,
};
const QUEUE_ROW = {
  chapter_id: "c3", chapter: "Circles", subject: "Mathematics", open_mistakes: 4, trigger_count: 1,
  ready: true, mode: "wide", planned_size: 12, relearn_above: 8, state: "in_recovery",
  in_recovery: true, last_recovery_readiness: null, recovered_at: null, rounds_taken: 0,
};

vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT } = await import("@/gurukul/emptyStudent");
  const value = { ...EMPTY_STUDENT, streak: 0 };
  return { useGurukulStudent: () => value };
});
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "s", userId: "u", role: "student", studentId: "st" }, ready: true, settled: true, studentId: "st", classId: "c" };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic", () => ({ useAcademicLive: () => 0, RecoveryEngineService: engine }));
vi.mock("@/academic/services/decisionEngineService", () => ({ DecisionEngineService: { getWeakAreasV2: () => Promise.resolve([]) } }));
vi.mock("@/hooks/useAnalysisPageData", () => ({
  useAnalysisPageData: () => ({
    data: { totals: { correct: 80, wrong: 50, skipped: 0, accuracy_pct: 62 }, recent_sessions: [], attempt_hours: new Array(24).fill(0) },
    loading: false, error: null, reload: () => {},
  }),
}));
vi.mock("@/hooks/useStudentPerformanceCharts", () => ({
  useStudentPerformanceCharts: () => ({ data: { practice_trend: [], weekly_activity: [] }, loading: false, error: null, reload: () => {} }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: {
    mistake_count: 4, recovery_pending: 1, self_practice: { sessions_completed: 12 },
    // The first is under the evidence floor; the Topics tab drops it.
    weak_topics: [
      { subject: "Mathematics", chapter: "Circles", topic: "Tangents", accuracy: 0, attempts: 1 },
      { subject: "Mathematics", chapter: "Algebra", topic: "Linear Equations", accuracy: 40, attempts: 20 },
    ],
    activity_heatmap: [],
  }, loading: false, error: null, reload: () => {} }),
}));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({ data: {
    by_subject: [{ subject: "Mathematics", attempts: 60, answered: 60, timed: 0, correct: 30, skipped: 0, accuracy: 50, avg_sec: null, total_min: null }],
    by_chapter: [
      { chapter: "Probability", subject: "Mathematics", attempts: 30, answered: 30, timed: 0, correct: 9, skipped: 0, accuracy: 30, avg_sec: null, total_min: null },
      { chapter: "Statistics", subject: "Mathematics", attempts: 30, answered: 30, timed: 0, correct: 28, skipped: 0, accuracy: 93, avg_sec: null, total_min: null },
    ],
    by_topic: [], by_difficulty: [],
    effort: { attempts: 60, solution_viewed: 0, repeat_attempts: 0, first_try_attempts: 60, first_try_correct: 30 },
    recurring: [],
  }, loading: false, error: null, reload: () => {} }),
}));

import Analysis from "./Analysis";

const openTab = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));
const settle = async () => {
  render(<Analysis />);
  await screen.findByText("Analysis");
  await new Promise((r) => setTimeout(r, 30));
};

describe("Analysis — the engine panels", () => {
  beforeEach(() => {
    engine.getChapterStates.mockReset();
    engine.getRecoveryQueue.mockReset();
  });

  it("says a failed schedule read failed, never that nothing is due, and Try again reads it again", async () => {
    engine.getChapterStates.mockRejectedValueOnce(new Error("57014")).mockResolvedValue([RECOVERED_AND_CLEAR, IN_RECOVERY]);
    engine.getRecoveryQueue.mockRejectedValueOnce(new Error("57014")).mockResolvedValue([QUEUE_ROW]);
    await settle();
    expect(screen.getByText("Could not read your revision schedule")).toBeInTheDocument(); // Overview card
    openTab("Topics");
    expect(screen.getByText(/Could not read your recovery chapters/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing due for revision today")).toBeNull();
    expect(screen.queryByText("No chapters in recovery yet")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect(await screen.findByText("Circles")).toBeInTheDocument();
    expect(engine.getChapterStates).toHaveBeenCalledTimes(2);
  });

  it("POSITIVE CONTROL: a schedule that is read and empty says nothing is due", async () => {
    engine.getChapterStates.mockResolvedValue([]);
    engine.getRecoveryQueue.mockResolvedValue([]);
    await settle();
    openTab("Topics");
    expect(screen.getByText("Nothing due for revision today")).toBeInTheDocument();
    expect(screen.getByText("No chapters in recovery yet")).toBeInTheDocument();
  });

  it("counts a recovered chapter that has left the recovery queue", async () => {
    // Algebra is recovered with nothing open, so the queue does not list it.
    engine.getChapterStates.mockResolvedValue([RECOVERED_AND_CLEAR, IN_RECOVERY]);
    engine.getRecoveryQueue.mockResolvedValue([QUEUE_ROW]);
    await settle();
    openTab("Topics");
    const recovered = screen.getByText("Recovered").parentElement as HTMLElement;
    expect(recovered.textContent).toContain("1");
    expect(screen.getByText("Chapters in recovery")).toBeInTheDocument();
  });

  it("badges a weak chapter and never a strong one", async () => {
    engine.getChapterStates.mockResolvedValue([]);
    engine.getRecoveryQueue.mockResolvedValue([]);
    await settle();
    openTab("Subjects & Chapters");
    expect(screen.queryByText("Ready for revision")).toBeNull();
    // The control: the badge machinery still runs for the weak one.
    expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
  });

  it("suggests a priority the Topics tab would list, not one below the evidence floor", async () => {
    engine.getChapterStates.mockResolvedValue([]);
    engine.getRecoveryQueue.mockResolvedValue([]);
    await settle();
    const card = screen.getByText("Suggested priority today").parentElement as HTMLElement;
    expect(card.textContent).toContain("Linear Equations");
    expect(card.textContent).not.toContain("Tangents");
  });
});
