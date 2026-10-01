/**
 * Home's practice figures — today's sessions, the week's ring and the week's
 * chart — come from rpc_student_practice_time on the student's own calendar,
 * never from academic_daily_activity (the snapshot's activity_heatmap), whose
 * day is UTC and whose counts mix tests, homework and battles in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StudentPracticeTime } from "@/hooks/useStudentPracticeTime";

const state = vi.hoisted(() => ({
  time: null as StudentPracticeTime | null,
  timeError: null as string | null,
}));

vi.mock("@/gurukul/StudentContext", () => ({
  useGurukulStudent: () => ({ firstName: "Asha", class: "", goal: "", level: 2, xp: 120, streak: 1, rank: 0, totalStudents: 0, practiceAccuracy: 60 }),
  useGurukulShellReady: () => true,
  useGurukulAcademicIdentity: () => ({ schoolKind: "individual", examName: "CUET", examCode: "CUET" }),
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({
    // The old source, loaded with figures that must NOT appear: nine
    // practice sessions and four tests on today's (UTC) row.
    data: {
      recovery_pending: 0,
      revision_due: 0,
      activity_heatmap: [{ date: "2026-10-01", test: 4, homework: 0, battles: 0, self_practice: 9, minutes: 50 }],
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
}));
vi.mock("@/hooks/useStudentPracticeTime", () => ({
  useStudentPracticeTime: () => ({ data: state.time, loading: false, error: state.timeError, reload: () => {} }),
}));
// jsdom has no layout, so the real chart draws nothing; this one lists its data.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ data }: { data: { day: string; total: number }[] }) => (
    <ol aria-label="weekly activity">{data.map((d, i) => <li key={i}>{`${d.day} ${d.total}`}</li>)}</ol>
  ),
  Area: () => null,
  XAxis: () => null,
  Tooltip: () => null,
}));

const { default: Dashboard } = await import("./Dashboard");
const show = () => render(<Dashboard setPage={() => {}} />);
const day = (date: string, sessions: number, answered: number) => ({ date, ms: answered * 30000, answered, correct: answered, sessions });

beforeEach(() => {
  // Thursday 1 October 2026, mid-morning. Its week runs Mon 28 Sep – Sun 4 Oct.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
  state.timeError = null;
  state.time = {
    from: "2026-09-01",
    today: "2026-10-01",
    hours: Array(24).fill(0),
    days: [
      day("2026-09-20", 4, 20), // outside the week and the seven days
      day("2026-09-27", 3, 9),  // Sunday: in the seven days, last week
      day("2026-09-29", 1, 5),  // Tuesday this week
      day("2026-10-01", 2, 12), // today
    ],
  };
});
afterEach(() => { vi.useRealTimers(); });

describe("Home — practice on the student's own calendar", () => {
  it("the ring counts this week's practice sessions, not active days or tests", () => {
    show();
    expect(screen.getByRole("img", { name: "3 of 7 practice sessions this week" })).toBeTruthy();
  });

  it("today's mission counts today's practice sessions", () => {
    show();
    expect(screen.getByText("Keep practicing")).toBeTruthy();
  });

  it("sessions on earlier days do not count as today's", () => {
    state.time = { ...state.time!, days: state.time!.days.filter((d) => d.date !== "2026-10-01") };
    show();
    expect(screen.getByText("Start a practice session")).toBeTruthy();
    expect(screen.getByRole("img", { name: "1 of 7 practice sessions this week" })).toBeTruthy();
  });

  it("the chart is the last seven days of questions answered, rest days as zeros", () => {
    show();
    const items = screen.getByRole("list", { name: "weekly activity" }).querySelectorAll("li");
    expect(Array.from(items, (li) => li.textContent)).toEqual([
      "Fri 0", "Sat 0", "Sun 9", "Mon 0", "Tue 5", "Wed 0", "Thu 12",
    ]);
  });

  it("CONTROL: a student with no practice gets an empty week, whatever the old table says", () => {
    state.time = { ...state.time!, days: [] };
    show();
    expect(screen.getByRole("img", { name: "0 of 7 practice sessions this week" })).toBeTruthy();
    expect(screen.getByText("Start a practice session")).toBeTruthy();
    expect(screen.getByText("No activity yet")).toBeTruthy();
  });

  it("CONTROL: when practice time fails to load, the ring claims nothing", () => {
    state.time = null;
    state.timeError = "network down";
    show();
    expect(screen.getByRole("img", { name: "Practice sessions this week not loaded" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /of 7 practice sessions/ })).toBeNull();
  });
});
