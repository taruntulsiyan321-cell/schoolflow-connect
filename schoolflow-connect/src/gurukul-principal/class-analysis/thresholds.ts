/**
 * Class Analysis Thresholds - Part 9
 *
 * Single module. Imported everywhere. Never hardcoded in a component.
 */

export const THRESHOLDS = {
  ATTENDANCE_LOW: 80,           // percent
  CONSECUTIVE_ABSENCE: 3,       // days running
  CHRONIC_ABSENCE: 80,          // percent across term
  HOMEWORK_LOW: 60,             // percent
  SUBJECT_MARKS_LOW: 40,        // marks
  MARKS_OVERDUE: 7,             // days after exam
  CLASS_FLAGGED_ON_MARKS: 25,  // percent of students below 40
  REPORTING_WINDOW: 'current term to date',
  HOMEWORK_WINDOW: 7,           // rolling days of due dates
} as const
