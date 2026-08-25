/**
 * Analysis Thresholds - §7
 *
 * Single source of truth for all thresholds.
 * Never hardcode these in components.
 */

// Primitives. Every threshold value is declared exactly once, here, so the
// nested groups below and the flat aliases the redesign screens use can never
// drift apart.
const ATTENDANCE_LOW = 80;   // Below 80% flags a student
const HOMEWORK_LOW = 60;     // Below 60% flags completion rate
const SUBJECT_MARKS_LOW = 40; // Below 40% in a subject

export const THRESHOLDS = {
  attendance: {
    low: ATTENDANCE_LOW,
    consecutive: 3,    // 3 days running absence
    chronic: 80,       // Below 80% across the term (separate concept from `low`)
  },
  homework: {
    completion: HOMEWORK_LOW,
    window: 7,         // Rolling 7 days of due dates
  },
  marks: {
    pass: SUBJECT_MARKS_LOW,
    classFlag: 25,     // 25% or more students below pass → class flagged
  },
  upload: {
    overdue: 7,        // Marks overdue 7 days after exam
  },

  // Flat aliases read by the principal redesign screens, which were written
  // against a `class-analysis/thresholds` module that was never committed.
  ATTENDANCE_LOW,
  HOMEWORK_LOW,
  SUBJECT_MARKS_LOW,
} as const;

export type AttendanceThresholds = typeof THRESHOLDS.attendance;
export type HomeworkThresholds = typeof THRESHOLDS.homework;
export type MarksThresholds = typeof THRESHOLDS.marks;

/**
 * Check if a value crosses a threshold
 */
export function isBelowThreshold(value: number, threshold: number): boolean {
  return value < threshold;
}

/**
 * Get color based on threshold crossing
 */
export function getThresholdColor(value: number, threshold: number): 'default' | 'warning' | 'danger' {
  if (value >= threshold) return 'default';
  if (value >= threshold - 10) return 'warning';  // Within 10% of threshold
  return 'danger';
}
