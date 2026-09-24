import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

/**
 * The teacher's profile carries the homework they have set, beside their tests:
 * how much, how much released, how many hand-ins wait on their decision, and
 * the recent few with where each stands.
 */
const homeworkSummary = vi.fn();

vi.mock("@/academic", async () => {
  const hw = await vi.importActual<typeof import("@/academic/services/homeworkService")>(
    "@/academic/services/homeworkService",
  );
  return {
    HomeworkService: { summaryForTeacher: (...a: unknown[]) => homeworkSummary(...a) },
    TestService: { summaryForTeacher: vi.fn().mockResolvedValue({ total: 0, published: 0, submissions: 0, recent: [] }) },
    homeworkHasClosed: hw.homeworkHasClosed,
    useAcademicLive: () => 0,
  };
});
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "teacher-1", role: "teacher" }, ready: true };
  return { useAcademicContext: () => value };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "teacher-1", email: "t@example.com" }, signOut: vi.fn() };
  return { useAuth: () => value };
});
vi.mock("./useTeacherIdentity", () => {
  const identity = {
    loading: false,
    linked: true,
    teacherRowId: "teacher-row-1",
    id: "teacher-row-1",
    name: "Priya Sharma",
    employeeId: "T01",
    email: "t@example.com",
    phone: "",
    department: "Mathematics",
    subjects: ["Mathematics"],
    qualification: "",
    joinedDate: "",
    address: "",
    gender: "",
    isClassTeacher: false,
    classTeacherOf: null,
    googleLinked: false,
    googleEmail: null,
    mobileLinked: false,
    reload: vi.fn(),
  };
  return { useTeacherIdentity: () => identity, teacherInitials: () => "PS" };
});

import TeacherProfile from "./Profile";

const homework = (over: Record<string, unknown>) => ({
  id: "hw",
  title: "hw",
  subject: "Mathematics",
  className: "10",
  classSection: "A",
  status: "published",
  closesAt: "2020-01-10T11:30:00.000Z",
  resolvedAt: null,
  completion: null,
  ...over,
});

describe("the teacher's profile, on homework", () => {
  it("shows what they have set, what waits on them, and where each recent homework stands", async () => {
    homeworkSummary.mockResolvedValue({
      total: 7,
      published: 5,
      scheduled: 1,
      drafts: 1,
      archived: 0,
      awaitingReview: 3,
      recent: [
        homework({
          id: "hw-1",
          title: "Real numbers",
          completion: { homeworkId: "hw-1", classId: "c", students: 32, given: 28, awaitingReview: 3, accepted: 25, rejected: 0, notGiven: 4, completionPct: 87.5 },
        }),
        homework({ id: "hw-2", title: "Polynomials", status: "draft", closesAt: "2099-01-10T11:30:00.000Z" }),
      ],
    });
    render(<TeacherProfile />);

    const heading = await screen.findByText("Homework You Have Set");
    const section = heading.closest("div.bg-surface") as HTMLElement;
    await waitFor(() => expect(within(section).getByText("Real numbers")).toBeInTheDocument());
    expect(section.textContent).toContain("7Homework set");
    expect(section.textContent).toContain("5Released");
    expect(section.textContent).toContain("3Waiting for your decision");

    const released = within(section).getByText("Real numbers").closest("div.flex") as HTMLElement;
    expect(released.textContent).toMatch(/10.A · Mathematics · closed/);
    expect(released.textContent).toContain("28 of 32 handed in");
    const draft = within(section).getByText("Polynomials").closest("div.flex") as HTMLElement;
    expect(draft.textContent).toContain("not released");
    expect(homeworkSummary).toHaveBeenCalledWith(expect.anything(), { limit: 5 });
  });
});
