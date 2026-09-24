import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The student's profile, on homework: handed in, still to do, and missed —
 * missed measured at the deadline, so homework the student still has time for
 * is never counted against them — and a way to the homework itself, where it
 * is read, handed in and replaced.
 */
const listForStudent = vi.fn();

vi.mock("@/academic", async () => {
  const hw = await vi.importActual<typeof import("@/academic/services/homeworkService")>(
    "@/academic/services/homeworkService",
  );
  return {
    ProgressionService: {
      getSnapshot: vi.fn().mockRejectedValue(new Error("not part of this test")),
      leaderboard: vi.fn().mockRejectedValue(new Error("not part of this test")),
    },
    TestService: { listMarksForStudent: vi.fn().mockResolvedValue([]) },
    MarksService: { listForStudent: vi.fn().mockResolvedValue([]) },
    HomeworkService: { listForStudent: (...a: unknown[]) => listForStudent(...a) },
    RemarksService: { listForStudent: vi.fn().mockResolvedValue([]) },
    homeworkOutcome: hw.homeworkOutcome,
    useAcademicLive: () => 0,
  };
});
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "user-1", role: "student" }, ready: true, studentId: "stu-1" };
  return { useAcademicContext: () => value };
});
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "user-1" }, signOut: vi.fn() };
  return { useAuth: () => value };
});
vi.mock("@/hooks/useStudentBadges", () => {
  const value = { earned: [], loading: false };
  return { useStudentBadges: () => value };
});
vi.mock("@/gurukul/StudentContext", () => ({
  useGurukulAcademicIdentity: () => ({
    schoolKind: "school",
    examName: null,
    examCode: null,
  }),
}));
vi.mock("@/components/battleground/EquippedBadge", () => ({ EquippedBadge: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({
    data: { full_name: "Arjun Mehta", roll_number: 7, parent_name: null, parent_mobile: null, classes: { name: "10", section: "A" } },
    error: null,
  });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { supabase: { from: () => chain } };
});

import Profile from "./Profile";

const row = (id: string, status: string, given: boolean, closed: boolean) => ({
  homework: { id, title: id },
  standing: { homeworkId: id, classId: "class-1", studentId: "stu-1", submissionId: null, status, given, closed, closesAt: "", dueDate: "" },
  submission: null,
});

const tile = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("the student's profile, on homework", () => {
  beforeEach(() => {
    listForStudent.mockReset().mockResolvedValue([
      row("handed-in-open", "submitted", true, false),
      row("accepted-closed", "accepted", true, true),
      row("open-nothing", "not_submitted", false, false),
      row("rejected-open", "rejected", false, false),
      row("missed", "not_submitted", false, true),
    ]);
  });

  it("counts handed in, still to do and missed at the deadline apart", async () => {
    render(<Profile setPage={vi.fn()} />);
    await waitFor(() => expect(tile("Homework handed in")).toBe("2"));
    expect(tile("Still to do")).toBe("2");
    expect(tile("Missed at the deadline")).toBe("1");
    expect(listForStudent).toHaveBeenCalledWith(expect.anything(), "stu-1");
  });

  it("opens the homework page, where the work is read, handed in and replaced", async () => {
    const setPage = vi.fn();
    render(<Profile setPage={setPage} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open your homework/ }));
    expect(setPage).toHaveBeenCalledWith("assignments");
  });
});
