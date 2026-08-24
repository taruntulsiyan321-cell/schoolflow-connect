/**
 * Analysis Thresholds - §7
 *
 * Single source of truth for all thresholds.
 * Never hardcode these in components.
 */

export const THRESHOLDS = {
  attendance: {
    low: 80,           // Below 80% flags a student
    consecutive: 3,    // 3 days running absence
    chronic: 80,       // Below 80% across the term
  },
  homework: {
    completion: 60,    // Below 60% flags completion rate
    window: 7,         // Rolling 7 days of due dates
  },
  marks: {
    pass: 40,          // Below 40% in a subject
    classFlag: 25,     // 25% or more students below pass → class flagged
  },
  upload: {
    overdue: 7,        // Marks overdue 7 days after exam
  },
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
