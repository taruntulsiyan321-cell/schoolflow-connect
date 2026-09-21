import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// recharts' ResponsiveContainer observes its box on mount and jsdom has no
// ResizeObserver, so without this every chart on the page throws during the
// passive-effect flush and takes the whole render with it.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

/**
 * THE ANALYSIS PAGE, RENDERED, WITH THE NUMBERS PRODUCTION ACTUALLY RETURNED.
 *
 * Why this exists. Every other guard on this page reads its SOURCE and
 * asserts what it does or does not mention. That catches a source going
 * missing; it cannot catch the page printing the wrong number from the right
 * source, and it cannot catch the page not rendering at all — a memo reading
 * a binding declared below it throws at runtime and typechecks clean.
 *
 * The fixture below is the real record of student d1000003-0001 as measured
 * against production on 2026-09-19, chosen because it contains every shape
 * the page has historically got wrong:
 *
 *   Circles         8 attempts, 7 SKIPPED, 1 answered and wrong
 *   Statistics      8 attempts, 5 skipped
 *   Real Numbers   44 attempts, 19 skipped — a genuine 8%
 *   Social Science 79 attempts, ALL of them skipped
 *   Hindi           1 timed question at 300s
 *
 * So the assertions are not "a number appeared". They are: this chapter must
 * NOT carry a verdict, that one MUST, and the page must not confuse the two.
 */

const SUBJECTS = [
  { subject: "Mathematics",    attempts: 408, answered: 220, timed: 402, correct: 101, skipped: 188, accuracy: 45.9, avg_sec: 6.8, total_min: 45.5 },
  { subject: "Social Science", attempts: 79,  answered: 0,   timed: 79,  correct: 0,   skipped: 79,  accuracy: null, avg_sec: 0.3, total_min: 0.4 },
  { subject: "English",        attempts: 54,  answered: 0,   timed: 54,  correct: 0,   skipped: 54,  accuracy: null, avg_sec: 0.5, total_min: 0.5 },
  { subject: "Hindi",          attempts: 11,  answered: 0,   timed: 1,   correct: 0,   skipped: 11,  accuracy: null, avg_sec: 300, total_min: 5.0 },
];

const CHAPTERS = [
  { chapter: "Circles",        subject: "Mathematics", attempts: 8,   answered: 1,  timed: 8,   correct: 0,  skipped: 7,  accuracy: 0,    avg_sec: 0.4,  total_min: 0.1 },
  { chapter: "Real Numbers",   subject: "Mathematics", attempts: 44,  answered: 25, timed: 44,  correct: 2,  skipped: 19, accuracy: 8,    avg_sec: 1.0,  total_min: 0.7 },
  { chapter: "Statistics",     subject: "Mathematics", attempts: 8,   answered: 3,  timed: 8,   correct: 1,  skipped: 5,  accuracy: 33.3, avg_sec: 3.5,  total_min: 0.5 },
  { chapter: "Triangles",      subject: "Mathematics", attempts: 9,   answered: 2,  timed: 9,   correct: 1,  skipped: 7,  accuracy: 50,   avg_sec: 67.1, total_min: 10.1 },
];

const TOPICS = [
  { topic: "Reporting Imperative Sentences", subject: "English",     chapter: "Reported Speech", attempts: 5,  answered: 0,  timed: 5,  correct: 0,  skipped: 5,  accuracy: null, avg_sec: 0.9, total_min: 0.1 },
  { topic: "Degree and Value of a Polynomial", subject: "Mathematics", chapter: "Polynomials",   attempts: 45, answered: 32, timed: 41, correct: 10, skipped: 13, accuracy: 31.3, avg_sec: 1.0, total_min: 0.7 },
];

const SNAPSHOT = {
  mistake_count: 66,
  recovery_pending: 11,
  xp: { xp: 3195, level: 8 },
  weak_topics: [
    // Two rows: one with enough answers to be judged, one with a single
    // attempt. The tile must count what the list shows — one, not two.
    { subject: "Mathematics", chapter: "Polynomials", topic: "Word Problems on AP", accuracy: 31, attempts: 32 },
    { subject: "Mathematics", chapter: "Circles", topic: "Tangent Length", accuracy: 0, attempts: 1 },
  ],
  activity_heatmap: [
    { date: isoDaysAgo(1),   test: 0, homework: 0, battles: 0, self_practice: 3, minutes: 40 },
    { date: isoDaysAgo(3),   test: 0, homework: 0, battles: 0, self_practice: 2, minutes: 35 },
    { date: isoDaysAgo(10),  test: 0, homework: 0, battles: 0, self_practice: 4, minutes: 32 },
    // OUTSIDE the four-week window. Any figure labelled "4 weeks" that
    // includes this is summing the wrong span.
    { date: isoDaysAgo(120), test: 0, homework: 0, battles: 0, self_practice: 9, minutes: 600 },
  ],
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT: E } = await import("@/gurukul/emptyStudent");
  const value = { ...E, name: "Arjun Mehta", firstName: "Arjun", class: "10-A", xp: 3195, level: 8, streak: 2 };
  return { useGurukulStudent: () => value };
});

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = {
    ctx: { schoolId: "s1", userId: "u1", role: "student", studentId: "stu1" },
    ready: true,
    studentId: "stu1",
    classId: "c1",
  };
  return { useAcademicContext: () => value };
});

vi.mock("@/academic", () => ({
  useAcademicLive: () => 0,
  RecoveryEngineService: {
    getChapterStates: () => Promise.resolve([]),
    getRecoveryQueue: () => Promise.resolve([]),
  },
}));

vi.mock("@/academic/services/decisionEngineService", () => ({
  DecisionEngineService: { getWeakAreasV2: () => Promise.resolve([]) },
}));

vi.mock("@/hooks/useAnalysisPageData", () => ({
  useAnalysisPageData: () => ({
    data: {
      totals: { correct: 101, wrong: 119, skipped: 344, accuracy_pct: 46 },
      recent_sessions: [],
      attempt_hours: (() => { const h = new Array(24).fill(0); h[17] = 9; return h; })(),
    },
    loading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useStudentPerformanceCharts", () => ({
  useStudentPerformanceCharts: () => ({
    data: { practice_trend: [], weekly_activity: [] },
    loading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: SNAPSHOT, loading: false, error: null }),
}));

vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({
    data: {
      by_subject: SUBJECTS,
      by_chapter: CHAPTERS,
      by_topic: TOPICS,
      by_difficulty: [
        { difficulty: "easy",   rank: 1, attempts: 207, answered: 70, timed: 207, correct: 29, skipped: 137, accuracy: 41.4, avg_sec: 1.2 },
        { difficulty: "medium", rank: 2, attempts: 234, answered: 96, timed: 230, correct: 46, skipped: 138, accuracy: 47.9, avg_sec: 1.1 },
      ],
      effort: { attempts: 564, solution_viewed: 211, repeat_attempts: 481, first_try_attempts: 56, first_try_correct: 20 },
      recurring: [],
    },
    loading: false,
    error: null,
  }),
}));

import Analysis from "./Analysis";

const openTab = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

describe("Analysis — rendered", () => {
  it("agrees the verb with the count it just pluralised", () => {
    render(<Analysis />);
    // One weak topic survives the filter, and the sentence read
    // "1 topic need attention" — noun pluralised, verb left plural.
    expect(screen.getByText("1 topic needs attention")).toBeInTheDocument();
  });

  it("mounts and shows the page's one accuracy in the header", () => {
    render(<Analysis />);
    // Not from exam_readiness — the fixture has no exam_readiness at all, so
    // if this renders a percentage it came from analysis.totals.
    // The summary row renders "<label>: <value>" as one node. The fixture has
    // NO exam_readiness, so a percentage here can only have come from
    // analysis.totals — which is the point of the assertion.
    // The summary renders each row as <p>Label: <strong>value</strong></p>,
    // so the label alone is not its own text node. Match on the whole <p>.
    const row = (label: string) => {
      const p = Array.from(document.querySelectorAll("p")).find((el) =>
        (el.textContent ?? "").startsWith(`${label}:`),
      );
      expect(p, `no summary row for ${label}`).toBeTruthy();
      return p!.textContent ?? "";
    };
    expect(row("Practice accuracy")).toContain("46%");
    expect(row("Open mistakes")).toContain("66");
    // The Overview tile computes the same rate from the counts beside it.
    expect(screen.getByText("Questions solved")).toBeInTheDocument();
    expect(screen.getByText("220")).toBeInTheDocument();
  });

  it("refuses a verdict on a chapter whose attempts were mostly skips", () => {
    render(<Analysis />);
    openTab("Subjects & Chapters");
    const circles = screen.getByText("Circles").closest("div.p-4") as HTMLElement;
    expect(circles).toBeTruthy();
    // 8 attempts, 1 answered and wrong. It shows what happened...
    expect(within(circles).getByText("8")).toBeInTheDocument();
    // ...and refuses to call it 0%.
    expect(within(circles).getByText("not enough yet")).toBeInTheDocument();
    expect(within(circles).queryByText("0%")).toBeNull();
    expect(within(circles).queryByText("Needs attention")).toBeNull();
  });

  it("keeps the verdict on a chapter that earned one", () => {
    render(<Analysis />);
    openTab("Subjects & Chapters");
    const real = screen.getByText("Real Numbers").closest("div.p-4") as HTMLElement;
    // 44 attempts, 25 answered, a genuine 8%. The fix must not silence this.
    expect(within(real).getByText("8%")).toBeInTheDocument();
    expect(within(real).queryByText("not enough yet")).toBeNull();
  });

  it("says nothing about a subject where every attempt was skipped", () => {
    render(<Analysis />);
    openTab("Subjects & Chapters");
    const ss = screen.getByText("Social Science").closest("div.p-3, div.p-4") as HTMLElement;
    expect(ss).toBeTruthy();
    expect(within(ss).getByText("not enough yet")).toBeInTheDocument();
    expect(within(ss).queryByText("0%")).toBeNull();
  });

  it("does not name a one-question subject as the one that takes longest", () => {
    render(<Analysis />);
    openTab("Practice");
    const slowest = screen.getByText("Takes most time").closest("div") as HTMLElement;
    // Hindi has the largest avg_sec (300s) and ONE timed question.
    expect(within(slowest).queryByText("Hindi")).toBeNull();
  });

  it("counts only the topics the tab is willing to list", () => {
    render(<Analysis />);
    openTab("Topics");
    // weak_topics has TWO rows and one of them has a single attempt behind
    // it, so the list drops it. The tile must say 1, not 2.
    const tile = screen.getByText("Need attention").parentElement as HTMLElement;
    expect(within(tile).getByText("1")).toBeInTheDocument();
    expect(within(tile).queryByText("2")).toBeNull();
  });

  it("does not sum activity from outside the four-week window", () => {
    render(<Analysis />);
    openTab("Activity & Speed");
    // 40 + 35 + 32 = 107 minutes inside the window -> "1.8h".
    // The 600-minute day 120 days back would make it "11.8h".
    const tile = screen.getByText("Study time (4 weeks)").parentElement as HTMLElement;
    expect(within(tile).getByText("1.8h")).toBeInTheDocument();
    expect(within(tile).queryByText("11.8h")).toBeNull();
  });

  it("renders every tab without throwing", () => {
    render(<Analysis />);
    for (const t of ["Overview", "Subjects & Chapters", "Topics", "Practice", "Activity & Speed", "Milestones & Reports"]) {
      openTab(t);
      expect(screen.getByText("Analysis")).toBeInTheDocument();
    }
  });
});
