/**
 * THE RECOVERY, REVISION AND TREND PANELS — the three that had no coverage.
 *
 * Every other fixture in this folder leaves chapter_state, the recovery
 * queue and practice_trend empty, so those panels rendered their "nothing
 * yet" branch in every test and their real branch in none. Both defects
 * below were sitting in the branch nobody exercised.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
const iso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const ahead = (n: number) => new Date(Date.now() + n * 864e5).toISOString();

const CHAPTER_STATES = [
  { chapter_id: "c1", chapter: "Algebra", subject: "Mathematics", state: "recovered", revision_stage: 3,
    consecutive_passes: 3, next_revision_at: ahead(7), revision_due: false, recovered_at: iso(9),
    last_recovery_readiness: 0.82, open_mistakes: 0, revision_fresh_available: 8 },
  { chapter_id: "c2", chapter: "Triangles", subject: "Mathematics", state: "revision_due", revision_stage: 1,
    consecutive_passes: 1, next_revision_at: iso(1), revision_due: true, recovered_at: iso(20),
    last_recovery_readiness: 0.71, open_mistakes: 0, revision_fresh_available: 6 },
  { chapter_id: "c3", chapter: "Circles", subject: "Mathematics", state: "in_recovery", revision_stage: 0,
    consecutive_passes: 0, next_revision_at: null, revision_due: false, recovered_at: null,
    last_recovery_readiness: null, open_mistakes: 4, revision_fresh_available: 0 },
];
const RECOVERY_QUEUE = [
  { chapter_id: "c3", chapter: "Circles", subject: "Mathematics", open_mistakes: 4, trigger_count: 3,
    ready: true, mode: "deep", planned_size: 12, relearn_above: 10, state: "in_recovery",
    in_recovery: true, last_recovery_readiness: null, recovered_at: null, rounds_taken: 0 },
  { chapter_id: "c4", chapter: "Statistics", subject: "Mathematics", open_mistakes: 2, trigger_count: 3,
    ready: false, mode: "wide", planned_size: 6, relearn_above: 10, state: "has_mistakes",
    in_recovery: false, last_recovery_readiness: null, recovered_at: null, rounds_taken: 0 },
  { chapter_id: "c1", chapter: "Algebra", subject: "Mathematics", open_mistakes: 0, trigger_count: 3,
    ready: false, mode: "none", planned_size: 0, relearn_above: 10, state: "recovered",
    in_recovery: false, last_recovery_readiness: 0.82, recovered_at: iso(9), rounds_taken: 2 },
];

vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT } = await import("@/gurukul/emptyStudent");
  const value = { ...EMPTY_STUDENT, streak: 4, xp: 900, level: 4 };
  return { useGurukulStudent: () => value };
});
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "s", userId: "u", role: "student", studentId: "st" }, ready: true, studentId: "st", classId: "c" };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic", () => ({ useAcademicLive: () => 0,
  RecoveryEngineService: {
    getChapterStates: () => Promise.resolve(CHAPTER_STATES),
    getRecoveryQueue: () => Promise.resolve(RECOVERY_QUEUE),
  } }));
vi.mock("@/academic/services/decisionEngineService", () => ({ DecisionEngineService: { getWeakAreasV2: () => Promise.resolve([]) } }));
vi.mock("@/hooks/useAnalysisPageData", () => ({
  useAnalysisPageData: () => ({
    data: { totals: { correct: 80, wrong: 50, skipped: 30, accuracy_pct: 62 },
      // Six sessions, 40 then 70: §6.4's window is the latest THREE against
      // the previous three, so this is a clean +30 points either side.
      recent_sessions: [
        { id: "s1", subject: "Mathematics", chapter: "Algebra", question_count: 10, correct_count: 4, wrong_count: 6, measured_ms: 200000, accuracy_pct: 40, finished_at: iso(12) + "T10:00:00Z" },
        { id: "s2", subject: "Mathematics", chapter: "Algebra", question_count: 10, correct_count: 4, wrong_count: 6, measured_ms: 200000, accuracy_pct: 40, finished_at: iso(10) + "T10:00:00Z" },
        { id: "s3", subject: "Mathematics", chapter: "Algebra", question_count: 10, correct_count: 4, wrong_count: 6, measured_ms: 200000, accuracy_pct: 40, finished_at: iso(8) + "T10:00:00Z" },
        { id: "s4", subject: "Mathematics", chapter: "Algebra", question_count: 10, correct_count: 7, wrong_count: 3, measured_ms: 200000, accuracy_pct: 70, finished_at: iso(6) + "T10:00:00Z" },
        { id: "s5", subject: "Mathematics", chapter: "Algebra", question_count: 10, correct_count: 7, wrong_count: 3, measured_ms: 200000, accuracy_pct: 70, finished_at: iso(4) + "T10:00:00Z" },
        { id: "s6", subject: "Mathematics", chapter: "Algebra", question_count: 10, correct_count: 7, wrong_count: 3, measured_ms: 200000, accuracy_pct: 70, finished_at: iso(2) + "T10:00:00Z" },
      ],
      attempt_hours: (() => { const h = new Array(24).fill(0); h[9] = 12; return h; })() },
    loading: false, error: null, reload: () => {},
  }),
}));
vi.mock("@/hooks/useStudentPerformanceCharts", () => ({
  useStudentPerformanceCharts: () => ({ data: {
    practice_trend: [
      { date: iso(12), score_pct: 40, chapter: "Algebra" },
      { date: iso(10), score_pct: 40, chapter: "Algebra" },
      { date: iso(8), score_pct: 40, chapter: "Algebra" },
      { date: iso(6), score_pct: 70, chapter: "Algebra" },
      { date: iso(4), score_pct: 70, chapter: "Algebra" },
      { date: iso(2), score_pct: 70, chapter: "Algebra" },
    ],
    weekly_activity: [ { date: iso(2), total: 5, test: 0, battles: 0 }, { date: iso(9), total: 5, test: 0, battles: 0 } ],
  }, loading: false, error: null, reload: () => {} }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: {
    mistake_count: 6, recovery_pending: 2, xp: { xp: 900, level: 4 },
    self_practice: { sessions_completed: 31 },
    weak_topics: [{ subject: "Mathematics", chapter: "Algebra", topic: "Linear Equations", accuracy: 40, attempts: 20 }],
    activity_heatmap: [
      { date: iso(1), test: 0, homework: 0, battles: 0, self_practice: 5, minutes: 60 },
      { date: iso(2), test: 0, homework: 0, battles: 0, self_practice: 5, minutes: 60 },
    ],
  }, loading: false, error: null, reload: () => {} }),
}));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({ data: {
    by_subject: [{ subject: "Mathematics", attempts: 160, answered: 130, timed: 150, correct: 80, skipped: 30, accuracy: 61.5, avg_sec: 16, total_min: 40 }],
    by_chapter: [{ chapter: "Algebra", subject: "Mathematics", attempts: 160, answered: 130, timed: 150, correct: 80, skipped: 30, accuracy: 61.5, avg_sec: 16, total_min: 40 }],
    by_topic: [{ topic: "Linear Equations", subject: "Mathematics", chapter: "Algebra", attempts: 160, answered: 130, timed: 150, correct: 80, skipped: 30, accuracy: 61.5, avg_sec: 16, total_min: 40 }],
    by_difficulty: [{ difficulty: "easy", rank: 1, attempts: 80, answered: 70, timed: 80, correct: 56, skipped: 10, accuracy: 80, avg_sec: 8 }],
    effort: { attempts: 160, solution_viewed: 40, repeat_attempts: 60, first_try_attempts: 100, first_try_correct: 55 },
    recurring: [],
  }, loading: false, error: null, reload: () => {} }),
}));
import Analysis from "./Analysis";

describe("Analysis — recovery, revision and trends", () => {
  const openTab = (label: string) =>
    fireEvent.click(screen.getByRole("button", { name: label }));
  const settle = async () => {
    render(<Analysis />);
    await screen.findByText("Analysis");
    await new Promise((r) => setTimeout(r, 30));
  };

  it("reports a rise in POINTS, not percent", async () => {
    await settle();
    // 40 -> 70 across six sessions is +30 percentage POINTS on the subject
    // and chapter grids (TrendCell). The Topics-tab strengths list that
    // used to carry the same figure is gone (§6.1 / §10.8).
    openTab("Subjects & Chapters");
    expect(document.body.textContent).toMatch(/30 pts/);
    expect(document.body.textContent).not.toContain("+30%");
  });

  it("does not show a strengths panel on Topics (§6.1 / §10.8)", async () => {
    await settle();
    openTab("Topics");
    expect(screen.queryByText("Chapters getting better")).toBeNull();
    expect(screen.queryByText("Topics getting better")).toBeNull();
    expect(screen.getByText("Questions you keep getting wrong")).toBeInTheDocument();
  });

  it("uses the same unit in the subject and chapter grids", async () => {
    await settle();
    openTab("Subjects & Chapters");
    const text = document.body.textContent ?? "";
    expect(text).toContain("30 pts");
    expect(text).not.toMatch(/\b30%\s*Change/);
  });

  it("does not count one chapter as both done and pending", async () => {
    await settle();
    openTab("Topics");
    // Three chapters: Algebra solid, Triangles climbing and due, Circles
    // unscheduled. Algebra carries a next_revision_at because a solid
    // chapter stays on the ladder, so it was counted in both tiles and the
    // row read "1 Done, 2 Pending" for two scheduled chapters.
    const done = screen.getByText("Done").parentElement as HTMLElement;
    const pending = screen.getByText("Pending").parentElement as HTMLElement;
    expect(done.textContent).toContain("1");
    expect(pending.textContent).toContain("1");
  });

  it("still lists a chapter that is due for revision today", async () => {
    await settle();
    openTab("Topics");
    // The narrowing above must not reach dueToday.
    const heading = screen.getByText("Due for revision today");
    const section = heading.closest("div")?.parentElement as HTMLElement;
    expect((section?.textContent ?? document.body.textContent ?? "")).toContain("Triangles");
  });

  it("shows the recovery queue's own verdicts, not an invented score", async () => {
    await settle();
    openTab("Topics");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Circles");   // ready -> "Ready"
    expect(text).toContain("2 of 3");    // below the trigger -> progress
    expect(text).toContain("Recovered"); // engine's own word
  });

  it("draws the score trend and names its direction", async () => {
    await settle();
    expect(screen.getByText(/\+30 points across these sessions/)).toBeInTheDocument();
  });

  it("reports the server's session count rather than the fetched page", async () => {
    await settle();
    const row = Array.from(document.querySelectorAll("div")).find((d) =>
      (d.textContent ?? "").startsWith("Practice sessions"),
    );
    // self_practice.sessions_completed is 31; recent_sessions has 4 rows.
    expect(row?.textContent).toContain("31");
  });
});
