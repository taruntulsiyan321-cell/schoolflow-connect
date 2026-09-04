/**
 * CHUNK 10 — the thresholds module. One file. Imported everywhere.
 *
 * There was already a thresholds module, and it was already not one module:
 * `src/gurukul-principal/analysis/thresholds.ts` was imported by four pages
 * while `HOMEWORK_THRESHOLD = 60` was redeclared locally in two components and
 * written bare as `< 60` in a third. Four homes for one number. That file now
 * re-exports from here and declares nothing of its own.
 *
 * TWO THINGS THAT ARE DELIBERATELY NOT CONSTANTS HERE
 *
 * `MARKS_LOW` is not a constant. It is `exams.passing_marks`, per exam, and it
 * is NULL on 5 of 18 exams. The previous module hardcoded 40, which is not a
 * threshold — it is a fallback that was masking missing data on 28% of exams by
 * answering confidently for all of them. Use `belowPass()` below; where
 * `passing_marks` is NULL it returns `no_data` and NO FLAG FIRES.
 *
 * `CHRONIC_ABSENCE` is not here because it does not exist. It was 80 percent
 * across the year, and `ATTENDANCE_LOW` is 80 percent across the reporting
 * window, which — since terms were dropped — is the year. Same number, same
 * period, two names. "Chronic absentee" is a PRESENTATION of "below the
 * attendance threshold", not a second threshold.
 */

/** Percent. A student or section below this is flagged on attendance. */
export const ATTENDANCE_LOW = 80;

/** Days running. An unbroken absence run of this length is flagged. */
export const CONSECUTIVE_ABSENCE = 3;

/** Percent. Below this, a STUDENT's homework completion is flagged. */
export const HOMEWORK_LOW = 60;

/**
 * Percent. Below this, a HOMEWORK ITEM enters the teacher's action list.
 *
 * A DIFFERENT SUBJECT from HOMEWORK_LOW, which is why it is a different number
 * and not a drift. HOMEWORK_LOW asks "is this CHILD falling behind";
 * this asks "does this PIECE OF WORK still need chasing across the class".
 * A worksheet at 65% returned is not a struggling student — it is a task the
 * teacher has not finished collecting.
 *
 * Briefly converged onto HOMEWORK_LOW during the Chunk 10 threshold sweep. That
 * was wrong: it silently dropped every item between 60% and 70% off the action
 * list, which is a product change made inside a rename.
 */
export const HOMEWORK_ITEM_NEEDS_ACTION = 70;

/** Rolling days of due dates that "current homework" covers. */
export const HOMEWORK_WINDOW = 7;

/** Days after an exam before unentered marks are overdue. */
export const MARKS_OVERDUE = 7;

/** Percent of a section below pass before the whole section is flagged. */
export const CLASS_FLAGGED_ON_MARKS = 25;

/**
 * Percent. A student's subject or exam AVERAGE below this puts them on the
 * teacher's watchlist.
 *
 * RULED. It arrived as `SUBJECT_AVERAGE_LOW_AWAITING_RULING` in `bands.ts` and
 * was moved here by the ruling, because the move IS the ruling: something fires
 * on it. `LiveClassPanels` puts a named child in front of a teacher at this
 * number. A number that raises a person onto a list is a threshold, whatever
 * file it was living in, and `bands.ts` says so itself — it holds "only numbers
 * that trigger something" the other way round.
 *
 * It is NOT `exams.passing_marks`. That is per exam, expressed in marks, and
 * answers "did this child pass this paper" — an 8-mark pass on a 20-mark unit
 * test. This is one number for the whole school, expressed in percent, and
 * answers "is this child's average low enough that someone should look". Two
 * questions, two numbers; collapsing them is how a 20-mark test ends up judged
 * against a 40.
 *
 * The COLOUR ladder that starts at this same 40 lives in `bands.ts` and imports
 * it, so moving the flag moves the colour with it.
 */
export const SUBJECT_AVERAGE_LOW = 40;

/**
 * Every threshold, for the gate that proves no component declares its own.
 * A component importing this object is importing, not redeclaring.
 */
export const THRESHOLDS = {
  ATTENDANCE_LOW,
  HOMEWORK_ITEM_NEEDS_ACTION,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
  SUBJECT_AVERAGE_LOW,
} as const;

export type ThresholdName = keyof typeof THRESHOLDS;

/**
 * The reporting window: the current academic year's start to today.
 *
 * `academic_years` is authoritative, matched on `is_current`.
 * `schools.session_start_date` / `session_end_date` hold the same fact and
 * converge away — that is G9, two homes for one date, and the one that can
 * express more than one year wins.
 *
 * No current academic year is `no_data`, never a silent fallback to "the last
 * 365 days". A window nobody declared is not a window; it is a guess that would
 * make every figure in the app quietly wrong by an unknown amount.
 */
export interface ReportingWindow {
  startsOn: string;
  endsOn: string;
  academicYearId: string;
  label: string;
}

/** The shape this module needs from an academic_years row. */
export interface AcademicYearRow {
  id: string;
  name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_current: boolean | null;
}

import { type Metric, ok, noData } from "./types";

/**
 * Resolve the reporting window from the academic_years rows of one school.
 *
 * Takes rows rather than fetching, so it is pure and the golden tests can drive
 * it with fixtures. The fetch belongs to the caller.
 */
export function reportingWindow(
  rows: AcademicYearRow[],
  today: string,
): Metric<ReportingWindow> {
  const current = rows.filter((r) => r.is_current === true);

  if (current.length === 0) {
    return noData<ReportingWindow>(
      `${rows.length} academic year row(s), none marked is_current`,
    );
  }
  // Two current years is a data fault, not a tie to break. Picking one would
  // make every figure in the app depend on row order.
  if (current.length > 1) {
    return noData<ReportingWindow>(
      `${current.length} academic years are marked is_current; the window is ambiguous`,
    );
  }
  const y = current[0];
  if (!y.starts_on) {
    return noData<ReportingWindow>(`academic year ${y.name ?? y.id} has no starts_on`);
  }
  return ok(
    {
      startsOn: y.starts_on,
      endsOn: y.ends_on ?? today,
      academicYearId: y.id,
      label: y.name ?? "current academic year",
    },
    `academic_years.is_current: ${y.name ?? y.id}`,
  );
}

/**
 * Below pass, for one score against one exam.
 *
 * `passingMarks` NULL is `no_data` and no flag fires — the ruling, and the whole
 * reason a literal 40 is not acceptable here. An exam whose pass mark nobody
 * entered is an exam nobody can be below the pass of.
 *
 * `maxMarks` is needed because a threshold in marks is not a threshold in
 * percent: passing_marks in this database ranges 8 to 33 across five distinct
 * max_marks values.
 */
export function belowPass(
  scored: number | null,
  passingMarks: number | null,
  maxMarks: number | null,
): Metric<boolean> {
  if (scored === null || scored === undefined) {
    return noData<boolean>("no mark recorded for this student");
  }
  if (passingMarks === null || passingMarks === undefined) {
    return noData<boolean>("exams.passing_marks is not set for this exam");
  }
  const basis =
    maxMarks != null && maxMarks > 0
      ? `${scored} against a pass mark of ${passingMarks} out of ${maxMarks}`
      : `${scored} against a pass mark of ${passingMarks}`;
  return ok(scored < passingMarks, basis);
}
