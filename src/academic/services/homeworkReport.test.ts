import { describe, expect, it } from "vitest";
import {
  classHomeworkReportFilename,
  classHomeworkReportRows,
  classHomeworkTally,
  homeworkReportFilename,
  homeworkReportRows,
} from "@/academic/services/homeworkReport";
import type { ReviewRow } from "@/academic/services/homeworkService";

/**
 * The homework report, held to what it is for: whether each student did the
 * homework, in register order, with a rejected hand-in counted as not done.
 */
const standing = (studentId: string, status: string, given: boolean, closed = true) => ({
  homeworkId: "hw-1",
  classId: "class-1",
  studentId,
  submissionId: status === "not_submitted" ? null : `sub-${studentId}`,
  status: status as ReviewRow["standing"]["status"],
  given,
  closed,
  closesAt: "2026-09-20T11:30:00.000Z",
  dueDate: "2026-09-20",
});

const handIn = (studentId: string, status: string, decidedAt: string | null) => ({
  id: `sub-${studentId}`,
  homeworkId: "hw-1",
  studentId,
  status: status as ReviewRow["standing"]["status"],
  file: { path: `${studentId}/w.pdf`, name: `${studentId}.pdf`, mime: "application/pdf", size: 10 },
  submittedAt: "2026-09-19T10:00:00.000Z",
  decidedAt,
  decidedBy: decidedAt ? "teacher-1" : null,
  updatedAt: "2026-09-19T10:00:00.000Z",
});

const rows: ReviewRow[] = [
  { studentId: "s10", standing: standing("s10", "not_submitted", false), submission: null },
  { studentId: "s2", standing: standing("s2", "rejected", false), submission: handIn("s2", "rejected", "2026-09-19T12:00:00.000Z") },
  { studentId: "s1", standing: standing("s1", "accepted", true), submission: handIn("s1", "accepted", "2026-09-19T12:00:00.000Z") },
  { studentId: "s3", standing: standing("s3", "submitted", true), submission: handIn("s3", "submitted", null) },
];

const roster = [
  { id: "s1", fullName: "Arjun Mehta", rollNumber: "1" },
  { id: "s2", fullName: "Priya Patel", rollNumber: "2" },
  { id: "s3", fullName: "Rohan Singh", rollNumber: "3" },
  { id: "s10", fullName: "Zara Khan", rollNumber: "10" },
];

describe("the homework report", () => {
  it("lists every student in roll order, numerically", () => {
    expect(homeworkReportRows(rows, roster).map((r) => r.Roll)).toEqual(["1", "2", "3", "10"]);
  });

  it("marks accepted and awaiting-review work as done, and rejected or missing work as not done", () => {
    const done = Object.fromEntries(homeworkReportRows(rows, roster).map((r) => [r.Student, r.Done]));
    expect(done).toEqual({ "Arjun Mehta": "Yes", "Priya Patel": "No", "Rohan Singh": "Yes", "Zara Khan": "No" });
  });

  it("carries the standing, the hand-in's file, and when it was decided", () => {
    const [arjun, priya, rohan, zara] = homeworkReportRows(rows, roster);
    expect(arjun.Standing).toBe("Accepted");
    expect(arjun.File).toBe("s1.pdf");
    expect(arjun["Decided at"]).not.toBe("");
    expect(priya.Standing).toBe("Not handed in");
    expect(rohan["Decided at"]).toBe("");
    expect(zara.File).toBe("");
    expect(zara["Handed in at"]).toBe("");
  });

  it("still lists a student the roster no longer carries", () => {
    const report = homeworkReportRows(rows, roster.filter((s) => s.id !== "s3"));
    expect(report).toHaveLength(4);
    expect(report.some((r) => r.Student.startsWith("Student s3"))).toBe(true);
  });

  // No extension: exportCSV adds ".csv", and a name carrying one downloaded as "….csv.csv".
  it("names the file after the homework and its deadline, leaving the extension to exportCSV", () => {
    expect(homeworkReportFilename({ title: "Real numbers: Ex 1.2!", dueDate: "2026-09-20" })).toBe(
      "homework-real-numbers-ex-1-2-2026-09-20",
    );
    expect(homeworkReportFilename({ title: "!!!", dueDate: "2026-09-20" })).toBe("homework-report-2026-09-20");
  });
});

/**
 * The class report: one line per student across all of a class's released
 * homework, counted at each deadline — the principal's Students tab and its
 * download read the same tally.
 */
describe("the class homework report", () => {
  // Four homework for Arjun: accepted (closed), awaiting review (open), rejected
  // past the deadline (missed), rejected while still open (to do again).
  // Priya: nothing handed in on one closed and one open homework.
  const st = (studentId: string, homeworkId: string, status: string, given: boolean, closed: boolean) => ({
    ...standing(studentId, status, given, closed),
    homeworkId,
  });
  const standings = [
    st("s1", "hw-1", "accepted", true, true),
    st("s1", "hw-2", "submitted", true, false),
    st("s1", "hw-3", "rejected", false, true),
    st("s1", "hw-4", "rejected", false, false),
    st("s2", "hw-1", "not_submitted", false, true),
    st("s2", "hw-2", "not_submitted", false, false),
  ];

  it("counts done, missed at the deadline and still to do — a rejection is never done", () => {
    const [arjun, priya] = classHomeworkTally(standings, roster);
    expect(arjun.row).toMatchObject({ set: 4, done: 2, accepted: 1, awaitingReview: 1, missed: 1, toDo: 1 });
    expect(priya.row).toMatchObject({ set: 2, done: 0, missed: 1, toDo: 1 });
  });

  it("lists every student on the roll, a student with nothing set to them included, in roll order", () => {
    const tally = classHomeworkTally(standings, roster);
    expect(tally.map((t) => t.name)).toEqual(["Arjun Mehta", "Priya Patel", "Rohan Singh", "Zara Khan"]);
    expect(tally[2].row).toMatchObject({ set: 0, done: 0, missed: 0, toDo: 0 });
  });

  it("downloads the same numbers the screen shows", () => {
    const [arjun] = classHomeworkReportRows(classHomeworkTally(standings, roster));
    expect(arjun).toEqual({
      Roll: "1",
      Student: "Arjun Mehta",
      "Homework set": "4",
      Done: "2",
      Accepted: "1",
      "Awaiting review": "1",
      "Missed at the deadline": "1",
      "Still to do": "1",
    });
  });

  it("names the file after the class and the day it was taken, leaving the extension to exportCSV", () => {
    expect(classHomeworkReportFilename("10 A", new Date(2026, 8, 15, 23, 30))).toBe("homework-10-a-2026-09-15");
  });
});
