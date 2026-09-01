/**
 * Principal analysis thresholds — CONVERGED (Chunk 10).
 *
 * This file declared its own copies of ATTENDANCE_LOW, HOMEWORK_LOW and the
 * rest. That made it the second home for numbers that now have exactly one, in
 * `src/academic/metrics/thresholds.ts`. It declares nothing of its own any more
 * and re-exports, so the four pages importing it keep working and there is one
 * number to change.
 *
 * TWO THINGS THE CONVERGENCE CHANGED, not just moved:
 *
 * `attendance.chronic` is gone. It was 80 "across the term" here and 80 "across
 * the year" in the build document, while ATTENDANCE_LOW is 80 across the
 * reporting window — which, since terms were dropped, IS the year. One number,
 * one period, three names. `chronic` now points at ATTENDANCE_LOW, because
 * "chronic absentee" is a presentation of "below the attendance threshold" and
 * never was a second threshold.
 *
 * `marks.pass` was 40, hardcoded. Below-pass for an EXAM is
 * `exams.passing_marks`, per exam, and it is NULL on 5 of 18 — where NULL, the
 * answer is `no_data` and no flag fires. Use `belowPass()` from the metrics
 * module for that.
 *
 * BUT the 40 here is not doing that job. Every call site applies it to a SUBJECT
 * AVERAGE — `student.testAvg`, `section.examAvg` — which is a different
 * measurement from "did this student fail this exam", and the build document
 * lists no threshold for it. So it stays, named for what it actually is, and is
 * flagged as needing a ruling rather than quietly repointed at a per-exam
 * function that means something else.
 */

import {
  ATTENDANCE_LOW,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
} from "@/academic/metrics/thresholds";

export {
  ATTENDANCE_LOW,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
};

/**
 * AWAITING A RULING. A subject AVERAGE below this percent is shown in alert
 * colour on the principal screens. It is not `exams.passing_marks` — that is
 * per-exam and answers a different question — and the build document's threshold
 * list does not name it. Left at its existing value so no screen changes
 * meaning, and deliberately not folded into the metrics module until it is
 * either ruled a real threshold or removed.
 */
const SUBJECT_AVERAGE_LOW_AWAITING_RULING = 40;

export const THRESHOLDS = {
  attendance: {
    low: ATTENDANCE_LOW,
    consecutive: CONSECUTIVE_ABSENCE,
    /** @deprecated Same number, same period as `low`. Use `low`. */
    chronic: ATTENDANCE_LOW,
  },
  homework: {
    completion: HOMEWORK_LOW,
    window: HOMEWORK_WINDOW,
  },
  marks: {
    /** Subject AVERAGE, not exam pass mark. See the note above. */
    pass: SUBJECT_AVERAGE_LOW_AWAITING_RULING,
    classFlag: CLASS_FLAGGED_ON_MARKS,
  },
  upload: {
    overdue: MARKS_OVERDUE,
  },

  // Flat aliases read by the principal redesign screens.
  ATTENDANCE_LOW,
  HOMEWORK_LOW,
  SUBJECT_MARKS_LOW: SUBJECT_AVERAGE_LOW_AWAITING_RULING,
} as const;

export type AttendanceThresholds = typeof THRESHOLDS.attendance;
export type HomeworkThresholds = typeof THRESHOLDS.homework;
export type MarksThresholds = typeof THRESHOLDS.marks;

/**
 * Below a threshold — null-safe.
 *
 * The original took `value: number` and returned `value < threshold`. Now that
 * the metric fields are `number | null`, that signature was a trap: in
 * JavaScript `null < 80` is TRUE, because null coerces to 0. A class nobody had
 * marked would have been reported as the worst in the school.
 *
 * `null` means no_data or not_marked, and neither is "below". It returns false,
 * and a screen that needs to say "nobody marked this" reads the metric's state
 * rather than this boolean.
 */
export function isBelowThreshold(value: number | null | undefined, threshold: number): boolean {
  if (value === null || value === undefined) return false;
  return value < threshold;
}

/** Banding for display. Null is 'default' — an unknown is not a danger. */
export function getThresholdColor(
  value: number | null | undefined,
  threshold: number,
): "default" | "warning" | "danger" {
  if (value === null || value === undefined) return "default";
  if (value >= threshold) return "default";
  if (value >= threshold - 10) return "warning";
  return "danger";
}
