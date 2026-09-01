/**
 * CHUNK 10 — attendance metrics. One function per metric. Pure.
 *
 * These take rows and return metrics. They do not fetch, and they do not store
 * (§10: "No function stores its result"). Fetching belongs to the caller, which
 * makes every one of them drivable from a fixture by the golden-number tests.
 *
 * THE DEFECT THIS REPLACES, because it is the reason for the shape
 *
 * `foundation.ts:196` computed school attendance as the unweighted mean of
 * per-student `attendance_pct`, and was 6.5 points wrong on the demo school —
 * 85.94% against a true 92.41%. Three distinct faults in one expression:
 *
 *   1. A student who has NEVER been marked carries attendance_pct = 0.00 and was
 *      averaged in as 0% present. "Unmarked counted absent", verbatim.
 *   2. A student with 2 marked days weighed the same as one with 60.
 *   3. All students counted, when only 2 of 3 sections had submitted.
 *
 * Summing the raw counts and dividing once fixes all three at the same time, and
 * that is not a coincidence: each fault is a different consequence of averaging
 * ratios instead of dividing totals. A student with no marked days contributes
 * 0 to the numerator AND 0 to the denominator, so they leave the calculation
 * rather than dragging it down — which is exactly what "excluded from the
 * denominator, never counted absent" means, expressed as arithmetic instead of
 * as a rule somebody has to remember.
 *
 * The profile counts were checked against the raw attendance table before
 * anything was built on them: 146/158 both ways, exactly.
 */

import { type Metric, ok, noData, notMarked, pct, count, flag } from "./types";
import { ATTENDANCE_LOW, CONSECUTIVE_ABSENCE } from "./thresholds";

/** The attendance facts this module needs about one student. */
export interface AttendanceCounts {
  studentId: string;
  present: number;
  total: number;
}

/** One attendance record, for the metrics that need days rather than totals. */
export interface AttendanceDay {
  studentId: string;
  date: string;
  status: "present" | "absent" | "late" | "excused" | string;
}

/** Present counts as present. Late counts as present — a late student attended. */
export function isPresent(status: string): boolean {
  return status === "present" || status === "late";
}

// ── Student ────────────────────────────────────────────────────────────────

/** One student's attendance across the reporting window. */
export function studentAttendance(c: AttendanceCounts | null | undefined): Metric<number> {
  if (!c) return noData("no attendance profile for this student");
  return pct(c.present, c.total, `${c.present} of ${c.total} marked day(s)`);
}

// ── Section, school ────────────────────────────────────────────────────────

/**
 * A group of students — a section, a school, a teacher's classes.
 *
 * present ÷ marked, over the whole group at once. NOT the mean of the
 * per-student percentages, and NOT the mean of the per-section percentages.
 *
 * A student with `total === 0` has never been marked. They contribute nothing to
 * either side, so they are excluded rather than counted absent. When EVERY
 * student is in that position the result is `not_marked`, which is the honest
 * answer and is not 0%.
 */
export function groupAttendance(rows: AttendanceCounts[]): Metric<number> {
  if (rows.length === 0) return noData("no students in this group");

  let present = 0;
  let total = 0;
  let marked = 0;
  for (const r of rows) {
    if (r.total > 0) marked += 1;
    present += r.present;
    total += r.total;
  }
  if (total === 0) {
    return notMarked(`${rows.length} student(s), none with a marked day`);
  }
  return pct(
    present,
    total,
    `${present} of ${total} marked day(s) across ${marked} of ${rows.length} student(s)`,
  );
}

/**
 * School attendance for a single day.
 *
 * §10: "present ÷ students in sections that submitted". The denominator is
 * driven by the SUBMISSION, not by the roster: a section that has not submitted
 * contributes neither its present count nor its headcount, so a school where
 * half the sections have marked reads as the attendance of those sections and
 * says so in `basis` — rather than reading as half the real figure.
 */
export interface SectionDaySubmission {
  sectionId: string;
  submitted: boolean;
  present: number;
  /** Students in the section on that day — the denominator when submitted. */
  enrolled: number;
}

export function schoolAttendanceToday(sections: SectionDaySubmission[]): Metric<number> {
  if (sections.length === 0) return noData("no sections");

  const submitted = sections.filter((s) => s.submitted);
  if (submitted.length === 0) {
    return notMarked(`0 of ${sections.length} section(s) have submitted`);
  }
  const present = submitted.reduce((a, s) => a + s.present, 0);
  const enrolled = submitted.reduce((a, s) => a + s.enrolled, 0);
  return pct(
    present,
    enrolled,
    `${present} of ${enrolled} student(s) in ${submitted.length} of ${sections.length} section(s) that submitted`,
  );
}

// ── Trend, runs, concentration ─────────────────────────────────────────────

/** Attendance per day, oldest first. Days with no marks are omitted, not zeroed. */
export function attendanceTrend(days: AttendanceDay[]): Metric<{ date: string; pct: number }[]> {
  if (days.length === 0) return noData("no attendance records in the window");

  const byDate = new Map<string, { present: number; total: number }>();
  for (const d of days) {
    const e = byDate.get(d.date) ?? { present: 0, total: 0 };
    e.total += 1;
    if (isPresent(d.status)) e.present += 1;
    byDate.set(d.date, e);
  }
  const series = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, e]) => ({ date, pct: Math.round((e.present / e.total) * 1000) / 10 }));

  return ok(series, `${series.length} marked day(s)`);
}

/**
 * The longest unbroken run of absence, and whether it reaches the threshold.
 *
 * Runs are counted over MARKED days in date order. An unmarked day does not
 * break a run and does not extend it — the register simply says nothing about
 * that day, and treating silence as attendance would hide the runs this metric
 * exists to find.
 */
export function consecutiveAbsence(days: AttendanceDay[]): Metric<number> {
  if (days.length === 0) return noData("no attendance records in the window");

  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  let longest = 0;
  let current = 0;
  for (const d of sorted) {
    if (isPresent(d.status)) {
      current = 0;
    } else {
      current += 1;
      if (current > longest) longest = current;
    }
  }
  return count(longest, `longest run across ${sorted.length} marked day(s)`);
}

export function consecutiveAbsenceFlag(days: AttendanceDay[]): Metric<boolean> {
  return flag(consecutiveAbsence(days), CONSECUTIVE_ABSENCE, "at_or_above");
}

/**
 * Students below the attendance threshold.
 *
 * This is the list the UI has been calling "chronic absentees". There is no
 * separate chronic threshold: it was 80 over the year and ATTENDANCE_LOW is 80
 * over the reporting window, which is the year. One threshold, two names, and
 * the second is a presentation of the first.
 *
 * A student with no marked days is NOT in this list. They are not below the
 * threshold; nobody has said anything about them, and putting them in a list
 * headed "below 80%" would be the same lie the school average was telling.
 * They are returned separately so a screen can show them as owed, not as poor.
 */
export function belowAttendanceThreshold(rows: AttendanceCounts[]): Metric<{
  below: { studentId: string; pct: number }[];
  neverMarked: string[];
}> {
  if (rows.length === 0) return noData("no students in this group");

  const below: { studentId: string; pct: number }[] = [];
  const neverMarked: string[] = [];
  for (const r of rows) {
    if (r.total <= 0) {
      neverMarked.push(r.studentId);
      continue;
    }
    const p = Math.round((r.present / r.total) * 1000) / 10;
    if (p < ATTENDANCE_LOW) below.push({ studentId: r.studentId, pct: p });
  }
  below.sort((a, b) => a.pct - b.pct);
  return ok(
    { below, neverMarked },
    `${below.length} below ${ATTENDANCE_LOW}% of ${rows.length - neverMarked.length} marked student(s)` +
      (neverMarked.length ? `; ${neverMarked.length} never marked` : ""),
  );
}

/** Attendance by weekday, to surface a day the school loses students on. */
export function attendanceByDayOfWeek(days: AttendanceDay[]): Metric<
  { weekday: number; pct: number; marked: number }[]
> {
  if (days.length === 0) return noData("no attendance records in the window");

  const buckets = new Map<number, { present: number; total: number }>();
  for (const d of days) {
    const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    if (Number.isNaN(wd)) continue;
    const e = buckets.get(wd) ?? { present: 0, total: 0 };
    e.total += 1;
    if (isPresent(d.status)) e.present += 1;
    buckets.set(wd, e);
  }
  if (buckets.size === 0) return noData("no parseable dates in the attendance records");

  const out = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, e]) => ({
      weekday,
      pct: Math.round((e.present / e.total) * 1000) / 10,
      marked: e.total,
    }));
  return ok(out, `${days.length} marked record(s) across ${out.length} weekday(s)`);
}

/**
 * Absence concentration: what share of all absence belongs to the worst
 * students. A school at 92% where every absence is four children has a
 * different problem from one where it is spread across two hundred.
 */
export function absenceConcentration(rows: AttendanceCounts[], topN = 5): Metric<number> {
  if (rows.length === 0) return noData("no students in this group");

  const absences = rows
    .filter((r) => r.total > 0)
    .map((r) => r.total - r.present)
    .sort((a, b) => b - a);
  const totalAbsence = absences.reduce((a, b) => a + b, 0);
  if (totalAbsence === 0) {
    return ok(0, `no absence recorded across ${absences.length} marked student(s)`);
  }
  const top = absences.slice(0, topN).reduce((a, b) => a + b, 0);
  return pct(
    top,
    totalAbsence,
    `top ${Math.min(topN, absences.length)} of ${absences.length} student(s) hold ${top} of ${totalAbsence} absence(s)`,
  );
}

export function attendanceFlag(metric: Metric<number>): Metric<boolean> {
  return flag(metric, ATTENDANCE_LOW, "below");
}
