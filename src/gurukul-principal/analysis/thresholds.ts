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
 * lists no threshold for it.
 *
 * NOW RULED. That number is SUBJECT_AVERAGE_LOW in the metrics module, and this
 * file imports it like everything else here. It had survived as a local
 * copy under an "awaiting ruling" name — the last second home in this file, and
 * invisible to lint:threshold-literals because the metric vocabulary had no word
 * meaning "average". bands.test.ts already asserted the old name was gone from
 * bands.ts while this copy sat here unexamined, which is exactly how a converged
 * number grows a second home back.
 */

import {
  ATTENDANCE_LOW,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
  SUBJECT_AVERAGE_LOW,
} from "@/academic/metrics/thresholds";

export {
  ATTENDANCE_LOW,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
  SUBJECT_AVERAGE_LOW,
};

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
    pass: SUBJECT_AVERAGE_LOW,
    classFlag: CLASS_FLAGGED_ON_MARKS,
  },
  upload: {
    overdue: MARKS_OVERDUE,
  },

  // Flat aliases read by the principal redesign screens.
  ATTENDANCE_LOW,
  HOMEWORK_LOW,
  SUBJECT_MARKS_LOW: SUBJECT_AVERAGE_LOW,
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
