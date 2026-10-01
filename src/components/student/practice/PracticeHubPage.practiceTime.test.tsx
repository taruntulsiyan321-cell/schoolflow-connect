/**
 * The Practice hub's time figures (KNOWN_ISSUES 92) read rpc_student_practice_time
 * on the student's own calendar, over Analysis's four-week window — not the
 * snapshot's activity_heatmap, whose day is UTC, whose minutes are floored per
 * session, and whose "questions" were counts of tests, homework and sessions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { StudentPracticeTime } from "@/hooks/useStudentPracticeTime";

const state = vi.hoisted(() => ({ time: null as StudentPracticeTime | null }));

vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = { ctx: null, ready: false };
  return { ...actual, useAcademicContext: () => value };
});
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({
    // The old source, with figures that must NOT appear.
    data: { weak_topics: [], activity_heatmap: [{ date: "2026-10-01", test: 4, homework: 2, battles: 0, self_practice: 3, minutes: 600 }] },
    loading: false,
  }),
}));
vi.mock("@/hooks/useConceptMastery", () => ({ useConceptMastery: () => ({ items: [], loading: false }) }));
vi.mock("@/hooks/useStudentPracticeTime", () => ({
  useStudentPracticeTime: () => ({ data: state.time, loading: false, error: null, reload: () => {} }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { default: PracticeHubPage } = await import("./PracticeHubPage");
const show = () => render(<MemoryRouter><PracticeHubPage /></MemoryRouter>);
const tile = (label: string) => screen.getByText(label).parentElement!;
const day = (date: string, ms: number, answered: number) => ({ date, ms, answered, correct: answered, sessions: 1 });

beforeEach(() => {
  // Thursday 1 October 2026: the four-week grid runs Mon 7 Sep – Sun 4 Oct.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
  state.time = {
    from: "2026-09-01",
    today: "2026-10-01",
    hours: Array(24).fill(0),
    days: [
      day("2026-09-01", 3_600_000, 40), // before the four weeks
      day("2026-09-15", 1_200_000, 10),
      day("2026-10-01", 95_000, 7),     // today: 1m 35s, seven answered
    ],
  };
});
afterEach(() => { vi.useRealTimers(); });

describe("Practice hub — time on the student's own calendar", () => {
  it("questions today are today's answered practice questions", () => {
    show();
    expect(within(tile("Questions today")).getByText("7")).toBeTruthy();
    expect(within(tile("Time today")).getByText("1m 35s")).toBeTruthy();
  });

  it("practice time is the four weeks Analysis shows, to the second", () => {
    show();
    // 20m + 1m 35s; the 1 September hour is outside the window.
    expect(within(tile("Practice time (4 weeks)")).getByText("21m 35s")).toBeTruthy();
  });

  it("CONTROL: no practice reads as none, whatever the old table says", () => {
    state.time = { ...state.time!, days: [] };
    show();
    expect(within(tile("Questions today")).getByText("0")).toBeTruthy();
    expect(within(tile("Time today")).getByText("—")).toBeTruthy();
    expect(within(tile("Practice time (4 weeks)")).getByText("—")).toBeTruthy();
  });
});
