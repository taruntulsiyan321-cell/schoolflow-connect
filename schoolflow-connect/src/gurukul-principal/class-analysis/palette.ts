/**
 * Class Analysis Palette - Part 8.1
 *
 * Eight values. No ninth. No blue anywhere.
 */

export const PALETTE = {
  ground: '#FAFAF8',      // Page background
  surface: '#FFFFFF',     // Cards, table rows
  ink: '#1A1D21',         // Primary text, figures
  inkMuted: '#6B7280',    // Labels, comparison, —
  border: '#E5E5E0',      // Rules, dividers
  alert: '#B42318',       // Threshold breached, overdue
  alertBg: '#FEF3F2',     // Flagged cell background
  positive: '#067647',    // Improvement deltas only
} as const

/**
 * Distribution bands - Part 8.3
 *
 * One neutral ramp, ascending with performance, plus alert for failing band
 */
export const DISTRIBUTION_BANDS = {
  '0-40': '#B42318',
  '40-60': '#C7CDD4',
  '60-75': '#9AA4AF',
  '75-90': '#6B7684',
  '90-100': '#3F4854',
} as const
