import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SchoolHomeworkRow } from "@/academic";

/**
 * The admin's homework monitor, held to what it did not say: which class a
 * homework was set to and how much of it has been handed in (the table had
 * neither, under a heading promising both), and everything past the first 100
 * rows, which it dropped without a word.
 */
const listForSchool = vi.fn();

vi.mock("@/academic", () => ({
  AnalyticsService: {
    homeworkSchool: vi.fn().mockResolvedValue({
      published: 2,
      scheduled: 0,
      drafts: 0,
      archived: 0,
      students: 20,
      given: 12,
      awaitingReview: 3,
      rejected: 1,
      completionPct: 60,
    }),
  },
  HomeworkService: { listForSchool: (...a: unknown[]) => listForSchool(...a) },
  useAcademicLive: () => 0,
}));
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "admin-1", role: "admin" }, ready: true };
  return { useAcademicContext: () => value };
});

import HomeworkAdmin, { SCHOOL_HOMEWORK_PAGE } from "./Homework";

const row = (over: Partial<SchoolHomeworkRow>): SchoolHomeworkRow => ({
  id: "hw-1",
  schoolId: "school-1",
  classId: "class-1",
  subject: "Mathematics",
  title: "Real numbers",
  questionText: "q",
  questionFile: null,
  chapterId: null,
  topicId: null,
  chapterLabel: null,
  closesAt: "2026-09-20T11:30:00.000Z",
  dueDate: "2026-09-20",
  priority: "normal",
  workKind: "homework",
  status: "published",
  scheduledPublishAt: null,
  publishedAt: "2026-09-13T08:00:00.000Z",
  archivedAt: null,
  resolvedAt: null,
  missedCostsXp: true,
  createdBy: "teacher-1",
  createdAt: "2026-09-13T08:00:00.000Z",
  updatedAt: "2026-09-13T08:00:00.000Z",
  className: "10",
  classSection: "A",
  completion: {
    homeworkId: "hw-1",
    classId: "class-1",
    students: 10,
    given: 7,
    awaitingReview: 2,
    accepted: 5,
    rejected: 1,
    notGiven: 3,
    completionPct: 70,
  },
  ...over,
});

describe("HomeworkAdmin", () => {
  // Braces, not an expression: vitest calls a function returned from beforeEach
  // as that test's teardown, and mockReset returns the mock itself.
  beforeEach(() => {
    listForSchool.mockReset();
  });

  it("says which class each homework was set to, and how much of it was handed in", async () => {
    listForSchool.mockResolvedValue([row({}), row({ id: "hw-2", title: "A draft", status: "draft", completion: null })]);
    render(<HomeworkAdmin />);
    const published = (await screen.findByText("Real numbers")).closest("tr")!;
    expect(within(published).getByText("10-A")).toBeTruthy();
    expect(within(published).getByText("7/10 · 70%")).toBeTruthy();
    // A draft is set to nobody yet: no fraction to show.
    const draft = screen.getByText("A draft").closest("tr")!;
    expect(within(draft).getByText("—")).toBeTruthy();
  });

  it("finds homework by its class", async () => {
    listForSchool.mockResolvedValue([row({}), row({ id: "hw-2", title: "Another class's", className: "12", classSection: "B" })]);
    render(<HomeworkAdmin />);
    await screen.findByText("Real numbers");
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "12-B" } });
    expect(screen.getByText("Another class's")).toBeTruthy();
    expect(screen.queryByText("Real numbers")).toBeNull();
  });

  it("does not stop at a page: older homework is fetched on request", async () => {
    const firstPage = Array.from({ length: SCHOOL_HOMEWORK_PAGE }, (_, i) => row({ id: `new-${i}`, title: `Newer ${i}` }));
    listForSchool.mockImplementation((_ctx: unknown, page: { offset: number }) =>
      Promise.resolve(page.offset === 0 ? firstPage : [row({ id: "old", title: "The oldest homework" })]),
    );
    render(<HomeworkAdmin />);
    const more = await screen.findByRole("button", { name: "Show older homework" });
    expect(screen.queryByText("The oldest homework")).toBeNull();
    fireEvent.click(more);
    expect(await screen.findByText("The oldest homework")).toBeTruthy();
    expect(screen.getByText("Newer 0")).toBeTruthy();
    // A full page of table rows is the point of the test; given room beyond the
    // default 5 s for when the whole suite shares the machine.
  }, 20000);
});
