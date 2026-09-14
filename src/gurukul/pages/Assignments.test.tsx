import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HomeworkRecord } from "@/academic/repository/homeworkRepository";

/**
 * The student's homework screen, held to the owner's ruling of 2026-09-13 that
 * missing homework costs XP. The student is told while there is still time —
 * on homework to do, and on rejected work they can hand in again — and not
 * where it is untrue: work already handed in, homework that has closed, or
 * homework released before the rule existed. Each case first finds the
 * homework's title, so the line's absence is never an empty screen.
 */
const listForStudent = vi.fn();

vi.mock("@/academic", () => ({
  HOMEWORK_HAND_IN_FILE_PICKER: { accept: ".pdf", kinds: ["pdf", "image"], label: "an image or a PDF" },
  HOMEWORK_STANDING_LABELS: {
    to_do: "To do",
    handed_in: "Handed in — awaiting review",
    accepted: "Accepted",
    rejected: "Rejected",
    not_handed_in: "Not handed in",
  },
  HomeworkService: { listForStudent: (...a: unknown[]) => listForStudent(...a), submit: vi.fn() },
  WORK_KIND_LABELS: { homework: "Homework" },
  canHandIn: (row: { status: string; closed: boolean }) => !row.closed && row.status !== "accepted",
  homeworkStanding: (row: { status: string; given: boolean; closed: boolean }) =>
    row.status === "accepted" ? "accepted" : row.given ? "handed_in" : row.closed ? "not_handed_in" : row.status === "rejected" ? "rejected" : "to_do",
  useAcademicLive: () => 0,
}));
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" }, ready: true, studentId: "stu-1" };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic/storage/academicFileUpload", () => ({ attachmentOfFile: (f: { name: string }) => ({ name: f.name }) }));
vi.mock("@/gurukul-teacher/AttachmentUI", () => ({ AttachmentList: () => null, OneFileField: () => null }));

import Assignments from "./Assignments";

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

const row = (status: string, { closed = false, given = false, hw = {} as Partial<HomeworkRecord> } = {}) => ({
  homework: homework(hw),
  standing: {
    homeworkId: "hw-1",
    classId: "class-1",
    studentId: "stu-1",
    submissionId: status === "not_submitted" ? null : "sub-1",
    status,
    given,
    closed,
    closesAt: "2026-09-20T11:30:00.000Z",
    dueDate: "2026-09-20",
  },
  submission: null,
});

const LINE = "Missing it costs XP";
const renderPage = async () => {
  render(
    <MemoryRouter>
      <Assignments embedded />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Real numbers")).toBeTruthy();
};

describe("Assignments — what missing homework costs", () => {
  beforeEach(() => listForStudent.mockReset());

  it("tells the student on homework still to do", async () => {
    listForStudent.mockResolvedValue([row("not_submitted")]);
    await renderPage();
    expect(screen.getByText(LINE)).toBeTruthy();
  });

  it("tells the student on rejected work they can still hand in again", async () => {
    listForStudent.mockResolvedValue([row("rejected")]);
    await renderPage();
    expect(screen.getByText(LINE)).toBeTruthy();
  });

  it("says nothing on work handed in and awaiting review", async () => {
    listForStudent.mockResolvedValue([row("submitted", { given: true })]);
    await renderPage();
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it("says nothing once the homework has closed", async () => {
    listForStudent.mockResolvedValue([row("not_submitted", { closed: true })]);
    await renderPage();
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it("says nothing on homework released before the rule", async () => {
    listForStudent.mockResolvedValue([row("not_submitted", { hw: { missedCostsXp: false } })]);
    await renderPage();
    expect(screen.queryByText(LINE)).toBeNull();
  });
});
