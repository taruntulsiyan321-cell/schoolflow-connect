import type { HomeworkStandingRow } from "../repository/homeworkRepository";
import { HOMEWORK_STANDING_LABELS, homeworkOutcome, homeworkStanding, type ReviewRow } from "./homeworkService";

/** A student as the report names them. */
export interface HomeworkReportStudent {
  id: string;
  fullName: string;
  rollNumber: string | null;
}

const at = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * Rows in the order a register is read: roll number (numerically), then name.
 * Every homework screen and download lists students through here, so a screen
 * and the report it downloads cannot disagree about who comes first.
 *
 * A student the roster no longer carries (moved class) is still listed, by the
 * id their standing carries, because their standing is real.
 */
export function inRegisterOrder<T extends { studentId: string }>(
  rows: T[],
  roster: HomeworkReportStudent[],
): { roll: string; name: string; row: T }[] {
  const byId = new Map(roster.map((s) => [s.id, s]));
  return rows
    .map((row) => {
      const student = byId.get(row.studentId);
      return {
        roll: student?.rollNumber ?? "",
        name: student?.fullName ?? `Student ${row.studentId.slice(0, 8)}`,
        row,
      };
    })
    .sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

/**
 * The report of one homework: every student it is set to, whether they did it,
 * and what happened to what they handed in. §10.24's homework report — who
 * completed and who did not — for the teacher and the principal alike, built in
 * this one place so the two downloads cannot disagree.
 *
 * "Done" is the database's own `given` (handed in and awaiting review, or
 * accepted); a rejected hand-in, or nothing at all, is not done.
 */
export function homeworkReportRows(rows: ReviewRow[], roster: HomeworkReportStudent[]): Record<string, string>[] {
  return inRegisterOrder(rows, roster).map(({ roll, name, row }) => ({
    Roll: roll,
    Student: name,
    Done: row.standing.given ? "Yes" : "No",
    Standing: HOMEWORK_STANDING_LABELS[homeworkStanding(row.standing)],
    "Handed in at": at(row.submission?.submittedAt ?? null),
    "Decided at": at(row.submission?.decidedAt ?? null),
    File: row.submission?.file?.name ?? "",
  }));
}

/** `homework-real-numbers-2026-09-20.csv` — the title and deadline date, safe as a filename. */
export function homeworkReportFilename(homework: { title: string; dueDate: string }): string {
  return `homework-${slug(homework.title) || "report"}-${homework.dueDate}.csv`;
}

/** One student's homework record across a class's released homework. */
export interface ClassHomeworkTally {
  studentId: string;
  /** Released homework set to them. */
  set: number;
  /** The database's `given`: handed in and awaiting review, or accepted. */
  done: number;
  accepted: number;
  awaitingReview: number;
  /** Deadline passed without `given` — a rejected hand-in included. */
  missed: number;
  /** Deadline still open without `given` — a rejected hand-in that can be handed in again included. */
  toDo: number;
}

/**
 * A class's homework report: every student on the roll, and for each how much
 * of the class's released homework they did, missed at the deadline, or still
 * have open. Counted from `homework_student_status` — the same `given` and
 * `closed` every other homework count reads — never re-decided here.
 */
export function classHomeworkTally(
  standings: HomeworkStandingRow[],
  roster: HomeworkReportStudent[],
): { roll: string; name: string; row: ClassHomeworkTally }[] {
  const blank = (studentId: string): ClassHomeworkTally => ({
    studentId,
    set: 0,
    done: 0,
    accepted: 0,
    awaitingReview: 0,
    missed: 0,
    toDo: 0,
  });
  const tally = new Map<string, ClassHomeworkTally>();
  // Everyone on the roll is listed, including a student nothing was set to yet.
  for (const s of roster) tally.set(s.id, blank(s.id));
  for (const st of standings) {
    const t = tally.get(st.studentId) ?? blank(st.studentId);
    t.set += 1;
    const outcome = homeworkOutcome(st);
    if (outcome === "done") t.done += 1;
    else if (outcome === "missed") t.missed += 1;
    else t.toDo += 1;
    if (st.status === "accepted") t.accepted += 1;
    else if (st.status === "submitted") t.awaitingReview += 1;
    tally.set(st.studentId, t);
  }
  return inRegisterOrder([...tally.values()], roster);
}

/** The class report as CSV rows — the same numbers the Students tab shows. */
export function classHomeworkReportRows(tally: { roll: string; name: string; row: ClassHomeworkTally }[]): Record<string, string>[] {
  return tally.map(({ roll, name, row }) => ({
    Roll: roll,
    Student: name,
    "Homework set": String(row.set),
    Done: String(row.done),
    Accepted: String(row.accepted),
    "Awaiting review": String(row.awaitingReview),
    "Missed at the deadline": String(row.missed),
    "Still to do": String(row.toDo),
  }));
}

/** `homework-10-a-2026-09-15.csv` — the class and the day the report was taken. */
export function classHomeworkReportFilename(className: string, on = new Date()): string {
  const day = [on.getFullYear(), on.getMonth() + 1, on.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  return `homework-${slug(className) || "class"}-${day}.csv`;
}
