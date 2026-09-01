/**
 * CHUNK 10 — group rollups over student profile counts.
 *
 * One place. `getClassPerformance`, `getSchoolPerformance`, `getSchoolClassRollups`
 * and `getTeacherPerformance` all called their own version of this arithmetic and
 * all four had the same defect.
 *
 * WEIGHTING, AND WHERE IT IS AND IS NOT EXACT
 *
 * Attendance and homework are exact here: the profile carries raw counts
 * (`attendance_present`/`attendance_total`, `homework_submitted`/`homework_assigned`),
 * so the group figure is a single division over summed totals — which is the
 * definition, not an approximation of it. Verified against the raw attendance
 * table before this was built on: 146 present of 158 marked, both ways.
 *
 * Tests and exams are NOT exact and the basis says so. The profile stores a
 * per-student average percentage and a count, not the underlying marks, so the
 * best available group figure is that average weighted by the count. It is
 * strictly better than the unweighted mean it replaces — a student with one exam
 * no longer counts as much as one with twelve — but the exact figure needs
 * marks joined to `exams.max_marks`, because a percentage of a 25-mark test and
 * a percentage of a 100-mark exam are not the same measurement. That is the
 * `examAverage` metric in the marks family, and until it exists these two say
 * "weighted by exams recorded" rather than pretending.
 *
 * Stating that in `basis` is the point of `basis`.
 */

import { type Metric, noData, notMarked, pct, ok } from "./types";

export interface ProfileCounts {
  attendancePresent: number;
  attendanceTotal: number;
  homeworkSubmitted: number;
  homeworkAssigned: number;
  testsAttempted: number;
  testsAvgPct: number;
  examsRecorded: number;
  examsAvgPct: number;
}

export interface GroupRollup {
  studentCount: number;
  attendance: Metric<number>;
  homework: Metric<number>;
  tests: Metric<number>;
  exams: Metric<number>;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Map a snake_case profile row from PostgREST onto the shape this module takes. */
export function profileCountsFromRow(r: Record<string, unknown>): ProfileCounts {
  return {
    attendancePresent: num(r.attendance_present),
    attendanceTotal: num(r.attendance_total),
    homeworkSubmitted: num(r.homework_submitted),
    homeworkAssigned: num(r.homework_assigned),
    testsAttempted: num(r.tests_attempted),
    testsAvgPct: num(r.tests_avg_pct),
    examsRecorded: num(r.exams_recorded),
    examsAvgPct: num(r.exams_avg_pct),
  };
}

/**
 * A percentage weighted by how many records each student's average rests on.
 * Students with a zero count leave the calculation entirely rather than
 * contributing a 0 they never earned.
 */
function weighted(
  rows: ProfileCounts[],
  avgOf: (r: ProfileCounts) => number,
  countOf: (r: ProfileCounts) => number,
  unit: string,
): Metric<number> {
  let weightedSum = 0;
  let records = 0;
  let contributing = 0;
  for (const r of rows) {
    const c = countOf(r);
    if (c <= 0) continue;
    contributing += 1;
    records += c;
    weightedSum += avgOf(r) * c;
  }
  if (records === 0) {
    return notMarked(`${rows.length} student(s), none with a recorded ${unit}`);
  }
  return ok(
    Math.round((weightedSum / records) * 10) / 10,
    `weighted by ${records} ${unit}(s) across ${contributing} of ${rows.length} student(s)`,
  );
}

export function rollupFromProfiles(rows: ProfileCounts[]): GroupRollup {
  if (rows.length === 0) {
    const none = () => noData<number>("no students in this group");
    return {
      studentCount: 0,
      attendance: none(),
      homework: none(),
      tests: none(),
      exams: none(),
    };
  }

  let present = 0;
  let markedDays = 0;
  let markedStudents = 0;
  let submitted = 0;
  let assigned = 0;
  let assignedStudents = 0;
  for (const r of rows) {
    present += r.attendancePresent;
    markedDays += r.attendanceTotal;
    if (r.attendanceTotal > 0) markedStudents += 1;
    submitted += r.homeworkSubmitted;
    assigned += r.homeworkAssigned;
    if (r.homeworkAssigned > 0) assignedStudents += 1;
  }

  return {
    studentCount: rows.length,
    attendance:
      markedDays === 0
        ? notMarked(`${rows.length} student(s), none with a marked day`)
        : pct(
            present,
            markedDays,
            `${present} of ${markedDays} marked day(s) across ${markedStudents} of ${rows.length} student(s)`,
          ),
    homework:
      assigned === 0
        ? notMarked(`${rows.length} student(s), none with homework assigned`)
        : pct(
            submitted,
            assigned,
            `${submitted} of ${assigned} assigned task(s) across ${assignedStudents} of ${rows.length} student(s)`,
          ),
    tests: weighted(rows, (r) => r.testsAvgPct, (r) => r.testsAttempted, "test"),
    exams: weighted(rows, (r) => r.examsAvgPct, (r) => r.examsRecorded, "exam"),
  };
}
