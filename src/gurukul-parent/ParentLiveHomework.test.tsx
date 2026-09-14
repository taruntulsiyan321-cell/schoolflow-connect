import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HomeworkRecord } from "@/academic/repository/homeworkRepository";

/**
 * A parent's view of their child's homework, held to §10.15: the parent sees
 * everything the student sees except practice, and "the child's actual homework
 * submission". The card showed a status and nothing else — not the question,
 * not the file the child handed in.
 */
const listForStudent = vi.fn();

vi.mock("@/academic", () => ({
  AcademicProfileService: {},
  AnalyticsService: {},
  AiSummaryService: {},
  MarksService: {},
  ProgressionService: {},
  TestService: {},
  buildParentScheduledNarrative: vi.fn(),
  HOMEWORK_STANDING_LABELS: {
    to_do: "To do",
    handed_in: "Handed in — awaiting review",
    accepted: "Accepted",
    rejected: "Rejected — hand in again",
    not_handed_in: "Not handed in",
  },
  HomeworkService: { listForStudent: (...a: unknown[]) => listForStudent(...a) },
  WORK_KIND_LABELS: { homework: "Homework" },
  homeworkStanding: (row: { status: string; given: boolean }) =>
    row.status === "accepted" ? "accepted" : row.given ? "handed_in" : "to_do",
  useAcademicLive: () => 0,
}));
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "parent-1", role: "parent" }, ready: true, settled: true };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic/storage/academicFileUpload", () => ({ attachmentOfFile: (f: { name: string }) => ({ name: f.name }) }));
vi.mock("@/gurukul-teacher/AttachmentUI", () => ({
  AttachmentList: ({ items }: { items: { name: string }[] }) => <div>{items.map((i) => `file:${i.name}`).join(",")}</div>,
}));

import { ParentLiveHomework } from "./ParentLiveAcademic";

const homework = (over: Partial<HomeworkRecord>): HomeworkRecord => ({
  id: "hw-1",
  schoolId: "school-1",
  classId: "class-1",
  subject: "Mathematics",
  title: "Real numbers",
  questionText: "Prove that √2 is irrational.",
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
  ...over,
});

const standing = (status: string, given: boolean) => ({
  homeworkId: "hw-1",
  classId: "class-1",
  studentId: "stu-1",
  submissionId: status === "not_submitted" ? null : "sub-1",
  status,
  given,
  closed: false,
  closesAt: "2026-09-20T11:30:00.000Z",
  dueDate: "2026-09-20",
});

describe("ParentLiveHomework", () => {
  // Braces, not an expression: vitest calls a function returned from beforeEach
  // as that test's teardown, and mockReset returns the mock itself.
  beforeEach(() => {
    listForStudent.mockReset();
  });

  it("shows the question and the file the child handed in", async () => {
    listForStudent.mockResolvedValue([
      {
        homework: homework({}),
        standing: standing("submitted", true),
        submission: {
          id: "sub-1",
          homeworkId: "hw-1",
          studentId: "stu-1",
          status: "submitted",
          file: { path: "stu-1/answer.pdf", name: "answer.pdf", mime: "application/pdf", size: 10 },
          submittedAt: "2026-09-14T10:00:00.000Z",
          decidedAt: null,
          decidedBy: null,
          updatedAt: "2026-09-14T10:00:00.000Z",
        },
      },
    ]);
    render(<ParentLiveHomework studentId="stu-1" />);
    expect(await screen.findByText("Real numbers")).toBeTruthy();
    expect(screen.getByText("Prove that √2 is irrational.")).toBeTruthy();
    expect(screen.getByText("Handed in")).toBeTruthy();
    expect(screen.getByText("file:answer.pdf")).toBeTruthy();
  });

  it("shows an uploaded question as its file, and no hand-in where there is none", async () => {
    listForStudent.mockResolvedValue([
      {
        homework: homework({
          questionText: "",
          questionFile: { path: "t-1/sheet.pdf", name: "sheet.pdf", mime: "application/pdf", size: 10 },
        }),
        standing: standing("not_submitted", false),
        submission: null,
      },
    ]);
    render(<ParentLiveHomework studentId="stu-1" />);
    expect(await screen.findByText("file:sheet.pdf")).toBeTruthy();
    expect(screen.queryByText("Handed in")).toBeNull();
  });
});
