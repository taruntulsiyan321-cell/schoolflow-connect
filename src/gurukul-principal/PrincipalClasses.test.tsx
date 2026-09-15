import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HomeworkRecord } from "@/academic/repository/homeworkRepository";

/**
 * The principal's Classes tab, on real data (2026-09-15).
 *
 * What is worth asserting: the class list carries each class's homework
 * measured at the deadline (and no rate before anything closed); a class's
 * homework opens onto every student's standing and file, in register order,
 * with no decision offered to a principal; both reports download what the
 * screen shows; and the screen moves when a hand-in lands.
 *
 * Every case finds real content first — a class, a homework's title, a
 * student's name — so an empty screen can never pass for a correct one.
 */
const completionByClass = vi.fn();
const listPublishedForClass = vi.fn();
const standingsForClass = vi.fn();
const listForReview = vi.fn();
const listClassStudents = vi.fn();
const exportCSV = vi.fn();
const live = { version: 0 };

vi.mock("@/academic", async () => {
  const hw = await vi.importActual<typeof import("@/academic/services/homeworkService")>(
    "@/academic/services/homeworkService",
  );
  return {
    AttendanceService: { listClassStudents: (...a: unknown[]) => listClassStudents(...a) },
    HomeworkService: {
      completionByClass: (...a: unknown[]) => completionByClass(...a),
      listPublishedForClass: (...a: unknown[]) => listPublishedForClass(...a),
      standingsForClass: (...a: unknown[]) => standingsForClass(...a),
      listForReview: (...a: unknown[]) => listForReview(...a),
    },
    TestService: { listForClassDetailed: vi.fn().mockResolvedValue([]), classMarks: vi.fn() },
    TEST_KIND_LABELS: {},
    HOMEWORK_STANDING_LABELS: hw.HOMEWORK_STANDING_LABELS,
    homeworkStanding: hw.homeworkStanding,
    homeworkHasClosed: hw.homeworkHasClosed,
    useAcademicLive: () => live.version,
  };
});

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "principal-1", role: "principal" }, ready: true };
  return { useAcademicContext: () => value };
});

// A chainable stub shaped like the class list's two reads.
vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, unknown[]> = {
    classes: [{ id: "class-1", name: "10", section: "A", is_active: true }],
    students: [
      { id: "s1", class_id: "class-1" },
      { id: "s2", class_id: "class-1" },
    ],
  };
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "is", "in", "order"]) chain[m] = self;
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
    return chain;
  };
  return { supabase: { from: (t: string) => builder(t), channel: () => ({ on: () => ({}), subscribe: () => ({}) }) } };
});

vi.mock("@/gurukul-teacher/AttachmentUI", () => ({
  AttachmentList: ({ items }: { items: { name: string }[] }) => items.map((i) => i.name).join(", "),
}));
vi.mock("@/academic/storage/academicFileUpload", () => ({
  attachmentOfFile: (f: { name: string; path: string }) => ({ name: f.name, url: f.path }),
}));
vi.mock("@/lib/exportCsv", () => ({ exportCSV: (...a: unknown[]) => exportCSV(...a) }));

import PrincipalClasses from "./PrincipalClasses";

const PAST = "2020-01-10T11:30:00.000Z";
const FUTURE = "2099-01-10T11:30:00.000Z";

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
  closesAt: PAST,
  dueDate: "2026-09-10",
  priority: "normal",
  workKind: "homework",
  status: "published",
  scheduledPublishAt: null,
  publishedAt: "2020-01-08T08:00:00.000Z",
  archivedAt: null,
  resolvedAt: null,
  missedCostsXp: true,
  createdBy: "teacher-1",
  createdAt: "2020-01-08T08:00:00.000Z",
  updatedAt: "2020-01-08T08:00:00.000Z",
  ...over,
});

const completion = (given: number, students: number, awaitingReview: number) => ({
  homeworkId: "hw",
  classId: "class-1",
  students,
  given,
  awaitingReview,
  accepted: 0,
  rejected: 0,
  notGiven: students - given,
  completionPct: 0,
});

const standing = (studentId: string, homeworkId: string, status: string, given: boolean, closed: boolean) => ({
  homeworkId,
  classId: "class-1",
  studentId,
  submissionId: status === "not_submitted" ? null : `sub-${studentId}-${homeworkId}`,
  status,
  given,
  closed,
  closesAt: closed ? PAST : FUTURE,
  dueDate: "2026-09-10",
});

const handIn = (studentId: string, name: string) => ({
  id: `sub-${studentId}-hw-1`,
  homeworkId: "hw-1",
  studentId,
  status: "submitted",
  file: { path: `${studentId}/w.pdf`, name, mime: "application/pdf", size: 10 },
  submittedAt: "2020-01-09T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  updatedAt: "2020-01-09T10:00:00.000Z",
});

const roster = [
  { id: "s1", fullName: "Arjun Mehta", rollNumber: "1" },
  { id: "s2", fullName: "Bhavna Rao", rollNumber: "2" },
];

const rowOf = (el: HTMLElement) => el.closest("div.flex") as HTMLElement;

async function openRealNumbers() {
  fireEvent.click(await screen.findByRole("button", { name: /10 A/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Real numbers/ }));
  await waitFor(() => expect(listForReview).toHaveBeenCalledWith(expect.anything(), "hw-1"));
}

describe("the principal's Classes tab", () => {
  // Braces, not an expression: vitest calls a function returned from beforeEach
  // as that test's teardown, and mockReset returns the mock itself.
  beforeEach(() => {
    live.version = 0;
    exportCSV.mockReset();
    completionByClass.mockReset().mockResolvedValue(
      new Map([
        [
          "class-1",
          { classId: "class-1", closedHomework: 1, openHomework: 1, given: 1, expected: 2, completionPct: 50, awaitingReview: 1 },
        ],
      ]),
    );
    listPublishedForClass.mockReset().mockResolvedValue([
      { ...homework({ id: "hw-2", title: "Polynomials", closesAt: FUTURE, dueDate: "2099-01-10" }), completion: completion(0, 2, 0) },
      { ...homework({}), completion: completion(1, 2, 1) },
    ]);
    listClassStudents.mockReset().mockResolvedValue(roster);
    listForReview.mockReset().mockResolvedValue([
      { studentId: "s2", standing: standing("s2", "hw-1", "not_submitted", false, true), submission: null },
      { studentId: "s1", standing: standing("s1", "hw-1", "submitted", true, true), submission: handIn("s1", "arjun-work.pdf") },
    ]);
    standingsForClass.mockReset().mockResolvedValue([
      standing("s1", "hw-1", "submitted", true, true),
      standing("s1", "hw-2", "not_submitted", false, false),
      standing("s2", "hw-1", "not_submitted", false, true),
      standing("s2", "hw-2", "not_submitted", false, false),
    ]);
  });

  it("lists each real class with its roll and its homework, measured at the deadline", async () => {
    render(<PrincipalClasses />);
    const row = await screen.findByRole("button", { name: /10 A/ });
    // Class, students 2, homework released 2, 50% handed in by deadline, 1 awaiting review.
    await waitFor(() => expect(row.textContent).toBe("10 A2250%1"));
  });

  it("shows no rate for a class whose homework has not closed yet, rather than 0%", async () => {
    completionByClass.mockResolvedValue(
      new Map([
        [
          "class-1",
          { classId: "class-1", closedHomework: 0, openHomework: 1, given: 0, expected: 0, completionPct: null, awaitingReview: 0 },
        ],
      ]),
    );
    render(<PrincipalClasses />);
    const row = await screen.findByRole("button", { name: /10 A/ });
    await waitFor(() => expect(row.textContent).toBe("10 A21—0"));
  });

  it("opens a class onto its released homework, each with its hand-ins so far", async () => {
    render(<PrincipalClasses />);
    fireEvent.click(await screen.findByRole("button", { name: /10 A/ }));
    const closed = await screen.findByRole("button", { name: /Real numbers/ });
    expect(closed.textContent).toContain("1 / 2");
    expect(closed.textContent).toContain("Closed");
    expect(screen.getByRole("button", { name: /Polynomials/ }).textContent).toContain("Open");
    expect(listPublishedForClass).toHaveBeenCalledWith(expect.anything(), "class-1");
  });

  it("shows every student's standing and file in register order, with nothing for a principal to decide", async () => {
    render(<PrincipalClasses />);
    await openRealNumbers();
    const arjun = rowOf(await screen.findByText("Arjun Mehta"));
    expect(arjun.textContent).toContain("Handed in — awaiting review");
    expect(arjun.textContent).toContain("arjun-work.pdf");
    const bhavna = rowOf(screen.getByText("Bhavna Rao"));
    expect(bhavna.textContent).toContain("Not handed in");
    // Roll 1 before roll 2, though the rows arrived the other way round.
    expect(arjun.compareDocumentPosition(bhavna) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Prove that √2 is irrational.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Accept|Reject/ })).toBeNull();
  });

  it("downloads the homework's report: who did it and who did not", async () => {
    render(<PrincipalClasses />);
    await openRealNumbers();
    fireEvent.click(await screen.findByRole("button", { name: /Download report/ }));
    expect(exportCSV).toHaveBeenCalledTimes(1);
    const [filename, rows] = exportCSV.mock.calls[0] as [string, Record<string, string>[]];
    expect(filename).toBe("homework-real-numbers-2026-09-10.csv");
    expect(rows.map((r) => [r.Student, r.Done, r.File])).toEqual([
      ["Arjun Mehta", "Yes", "arjun-work.pdf"],
      ["Bhavna Rao", "No", ""],
    ]);
  });

  it("gives each student's homework record on the Students tab, and downloads it as the class report", async () => {
    render(<PrincipalClasses />);
    fireEvent.click(await screen.findByRole("button", { name: /10 A/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Students" }));
    await waitFor(() => expect(standingsForClass).toHaveBeenCalledWith(expect.anything(), "class-1"));
    // Roll, name, set, done, missed, still open.
    expect(rowOf(await screen.findByText("Arjun Mehta")).textContent).toBe("1Arjun Mehta2101");
    expect(rowOf(screen.getByText("Bhavna Rao")).textContent).toBe("2Bhavna Rao2011");

    fireEvent.click(screen.getByRole("button", { name: /Download class report/ }));
    const [filename, rows] = exportCSV.mock.calls[0] as [string, Record<string, string>[]];
    expect(filename).toMatch(/^homework-10-a-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows[1]).toMatchObject({ Student: "Bhavna Rao", Done: "0", "Missed at the deadline": "1", "Still to do": "1" });
  });

  it("moves when a hand-in lands, while the principal is looking", async () => {
    const { rerender } = render(<PrincipalClasses />);
    await openRealNumbers();
    expect(rowOf(await screen.findByText("Bhavna Rao")).textContent).toContain("Not handed in");

    listForReview.mockResolvedValue([
      { studentId: "s2", standing: standing("s2", "hw-1", "submitted", true, true), submission: handIn("s2", "bhavna-work.pdf") },
      { studentId: "s1", standing: standing("s1", "hw-1", "submitted", true, true), submission: handIn("s1", "arjun-work.pdf") },
    ]);
    // What AcademicLiveProvider does when homework_submissions changes.
    live.version = 1;
    rerender(<PrincipalClasses />);

    await waitFor(() => expect(rowOf(screen.getByText("Bhavna Rao")).textContent).toContain("bhavna-work.pdf"));
    expect(rowOf(screen.getByText("Bhavna Rao")).textContent).toContain("Handed in — awaiting review");
    expect(listForReview).toHaveBeenCalledTimes(2);
  });
});
