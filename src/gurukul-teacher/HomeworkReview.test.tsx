import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { HomeworkRecord } from "@/academic/repository/homeworkRepository";

/**
 * The teacher's review screen, held to two rulings.
 *
 * 1. Missing homework costs XP (2026-09-13): once the deadline has passed, a
 *    rejected hand-in cannot be handed in again, so rejecting it is charged as
 *    missed. The teacher is told so before deciding — and only where it is
 *    true: not while the homework is open, and not on homework released before
 *    the rule existed.
 * 2. A teacher sees every subject of a class they teach and decides only their
 *    own (docs/locked-decisions.md). Another subject's hand-ins are listed —
 *    the screen used to refuse them outright — with nothing to decide.
 *
 * Each case first finds the student's name, so an absence is never an empty screen.
 */
const listForReview = vi.fn();
const exportCSV = vi.fn();

vi.mock("@/lib/exportCsv", () => ({ exportCSV: (...a: unknown[]) => exportCSV(...a) }));
vi.mock("@/academic", () => ({
  AttendanceService: {
    listClassStudents: vi.fn().mockResolvedValue([{ id: "student-1", fullName: "Arjun Mehta", rollNumber: "7" }]),
  },
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
const VIEW_ONLY = /View only — hand-ins for Mathematics are accepted or rejected by its teachers/;

const renderReview = (over: Partial<HomeworkRecord> = {}, canDecide = true) =>
  render(<HomeworkReview homework={homework(over)} classId="class-1" canDecide={canDecide} onBack={vi.fn()} />);

describe("HomeworkReview — the XP a rejection costs", () => {
  // Braces, not an expression: vitest calls a function returned from beforeEach
  // as that test's teardown, and mockReset returns the mock itself.
  beforeEach(() => {
    listForReview.mockReset();
  });

  it("tells the teacher, past the deadline, that rejecting costs the student XP", async () => {
    listForReview.mockResolvedValue(awaitingReview(true));
    renderReview();
    expect(await screen.findByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("says nothing while the homework is still open — the student can hand in again", async () => {
    listForReview.mockResolvedValue(awaitingReview(false));
    renderReview();
    expect(await screen.findByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("says nothing on homework released before the rule, which costs nobody", async () => {
    listForReview.mockResolvedValue(awaitingReview(true));
    renderReview({ missedCostsXp: false });
    expect(await screen.findByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe("HomeworkReview — another subject's hand-ins", () => {
  beforeEach(() => {
    listForReview.mockReset();
  });

  it("lists them, says why there is nothing to decide, and offers no decision", async () => {
    listForReview.mockResolvedValue(awaitingReview(true));
    renderReview({}, false);
    expect(await screen.findByText("Arjun Mehta")).toBeTruthy();
    expect(screen.getByText(VIEW_ONLY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull();
    // Nor a warning about a decision this teacher cannot take.
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("offers the subject's own teacher the decision, and no view-only line", async () => {
    listForReview.mockResolvedValue(awaitingReview(false));
    renderReview({}, true);
    expect(await screen.findByText("Arjun Mehta")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy();
    expect(screen.queryByText(VIEW_ONLY)).toBeNull();
  });
});

describe("HomeworkReview — a homework nobody is counted on", () => {
  it("says the class had no students, not that the homework is unpublished, and offers no empty report", async () => {
    listForReview.mockReset().mockResolvedValue([]);
    renderReview();
    expect(await screen.findByText(/No student is counted on this homework/)).toBeTruthy();
    expect(screen.queryByText(/when it is published/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Download report/ })).toBeNull();
  });
});

/**
 * The homework's report — who did it and who did not — downloads from the
 * review screen, built by the same function as the principal's download, and
 * for a teacher who only views another subject's homework as well.
 */
describe("HomeworkReview — the report", () => {
  beforeEach(() => {
    listForReview.mockReset();
    exportCSV.mockReset();
  });

  it("downloads each student's roll, whether they did it, and their file", async () => {
    listForReview.mockResolvedValue(awaitingReview(true));
    renderReview({}, false);
    expect(await screen.findByText("Arjun Mehta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download report/ }));
    expect(exportCSV).toHaveBeenCalledTimes(1);
    const [filename, rows] = exportCSV.mock.calls[0] as [string, Record<string, string>[]];
    expect(filename).toBe("homework-real-numbers-2026-09-10.csv");
    expect(rows).toEqual([
      expect.objectContaining({ Roll: "7", Student: "Arjun Mehta", Done: "Yes", File: "w.pdf" }),
    ]);
  });
});
