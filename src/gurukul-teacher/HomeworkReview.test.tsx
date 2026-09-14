import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HomeworkRecord } from "@/academic/repository/homeworkRepository";

/**
 * The teacher's review screen, held to the owner's ruling of 2026-09-13 that
 * missing homework costs XP: once the deadline has passed, a rejected hand-in
 * cannot be handed in again, so rejecting it is charged as missed. The teacher
 * is told so before deciding — and only where it is true: not while the
 * homework is open, and not on homework released before the rule existed.
 * Each case first finds the Accept button, so the note's absence is never an
 * empty screen.
 */
const listForReview = vi.fn();

vi.mock("@/academic", () => ({
  AttendanceService: { listClassStudents: vi.fn().mockResolvedValue([{ id: "student-1", fullName: "Arjun Mehta" }]) },
  HomeworkService: { listForReview: (...a: unknown[]) => listForReview(...a), decide: vi.fn() },
  HOMEWORK_STANDING_LABELS: {
    to_do: "To do",
    handed_in: "Handed in — awaiting review",
    accepted: "Accepted",
    rejected: "Rejected",
    not_handed_in: "Not handed in",
  },
  homeworkStanding: (row: { status: string }) => (row.status === "submitted" ? "handed_in" : "to_do"),
}));
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "teacher-1", role: "teacher" }, ready: true };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic/storage/academicFileUpload", () => ({ attachmentOfFile: (f: { name: string }) => ({ name: f.name }) }));
vi.mock("./AttachmentUI", () => ({ AttachmentList: () => null }));

import { HomeworkReview } from "./HomeworkReview";

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
  closesAt: "2026-09-10T11:30:00.000Z",
  dueDate: "2026-09-10",
  priority: "normal",
  workKind: "homework",
  status: "published",
  scheduledPublishAt: null,
  publishedAt: "2026-09-08T08:00:00.000Z",
  archivedAt: null,
  resolvedAt: null,
  missedCostsXp: true,
  createdBy: "teacher-1",
  createdAt: "2026-09-08T08:00:00.000Z",
  updatedAt: "2026-09-08T08:00:00.000Z",
  ...over,
});

const awaitingReview = (closed: boolean) => [
  {
    studentId: "student-1",
    standing: {
      homeworkId: "hw-1",
      classId: "class-1",
      studentId: "student-1",
      submissionId: "sub-1",
      status: "submitted",
      given: true,
      closed,
      closesAt: "2026-09-10T11:30:00.000Z",
      dueDate: "2026-09-10",
    },
    submission: {
      id: "sub-1",
      homeworkId: "hw-1",
      studentId: "student-1",
      status: "submitted",
      file: { path: "student-1/w.pdf", name: "w.pdf", mime: "application/pdf", size: 10 },
      submittedAt: "2026-09-09T10:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      updatedAt: "2026-09-09T10:00:00.000Z",
    },
  },
];

const NOTE = /rejecting it now counts as missed homework and costs the student XP/;

describe("HomeworkReview — the XP a rejection costs", () => {
  beforeEach(() => listForReview.mockReset());

  it("tells the teacher, past the deadline, that rejecting costs the student XP", async () => {
    listForReview.mockResolvedValue(awaitingReview(true));
    render(<HomeworkReview homework={homework({})} classId="class-1" onBack={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("says nothing while the homework is still open — the student can hand in again", async () => {
    listForReview.mockResolvedValue(awaitingReview(false));
    render(<HomeworkReview homework={homework({})} classId="class-1" onBack={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("says nothing on homework released before the rule, which costs nobody", async () => {
    listForReview.mockResolvedValue(awaitingReview(true));
    render(<HomeworkReview homework={homework({ missedCostsXp: false })} classId="class-1" onBack={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
