/**
 * The live app is the individual student panel (2026-10-01): the live provider
 * subscribes to the signed-in student's own tables and to no school table —
 * not attendance, homework, marks, tests, notices, the calendar, battles,
 * doubts, leave, nor the school's activity feed — whatever role is signed in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({ role: "student" as string }));
const subs = vi.hoisted(() => ({ list: [] as { table: string; filter?: string }[] }));

vi.mock("@/auth", () => ({
  useAuth: () => ({ user: { id: "11111111-2222-3333-4444-555555555555" }, schoolId: "s1", isAuthenticated: true, role: auth.role }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_kind: string, opts: { table: string; filter?: string }) => { subs.list.push({ table: opts.table, filter: opts.filter }); return channel; },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});

const { AcademicLiveProvider } = await import("./AcademicLiveProvider");
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AcademicLiveProvider><div /></AcademicLiveProvider>
    </QueryClientProvider>,
  );

const SCHOOL_TABLES = [
  "attendance", "homework", "homework_submissions", "marks", "exams", "tests", "test_attempts",
  "test_marks", "notices", "school_calendar_events", "battle_participants", "battles",
  "battle_invites", "community_doubts", "community_doubt_answers", "leave_requests",
  "leave_decisions", "school_activity_feed",
];

beforeEach(() => { subs.list = []; });

describe("the live provider", () => {
  it("subscribes a student to their own tables, each fenced to them", () => {
    show();
    expect(subs.list.map((s) => s.table).sort()).toEqual([
      "notifications", "practice_sessions", "question_attempts", "student_academic_profiles",
      "student_badges", "student_xp",
    ]);
    for (const s of subs.list) {
      if (s.table === "student_academic_profiles") expect(s.filter).toBe("school_id=eq.s1");
      else expect(s.filter, s.table).toBe("user_id=eq.11111111-2222-3333-4444-555555555555");
    }
  });

  it.each(["student", "teacher", "principal", "admin", "super_admin", "parent"])(
    "subscribes no school table, whoever is signed in (%s)",
    (role) => {
      auth.role = role;
      show();
      for (const t of SCHOOL_TABLES) expect(subs.list.map((s) => s.table), t).not.toContain(t);
      // CONTROL: the subscriptions did run.
      expect(subs.list.length).toBe(6);
    },
  );
});
