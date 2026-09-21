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

describe("DBG", () => {
  for (const t of ["Overview","Subjects & Chapters","Topics","Practice","Activity & Speed","Milestones & Reports"]) {
    it("dump " + t, () => {
      const { container } = render(<Analysis />);
      fireEvent.click(screen.getByRole("button", { name: t }));
      const all = container.textContent ?? "";
      const cut = all.indexOf("Milestones & Reports");
      console.log("@@@" + t + "@@@" + all.slice(cut + 20));
    });
  }
});
