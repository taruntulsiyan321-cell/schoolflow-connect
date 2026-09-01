import { ATTENDANCE_LOW, HOMEWORK_LOW } from '@/academic/metrics/thresholds'
import { ATTENDANCE_COMFORTABLE, HOMEWORK_COMFORTABLE } from '@/academic/metrics/bands'

/**
 * Principal Portal Design System
 *
 * Quiet authority. Institutional clarity. Data-first.
 *
 * Palette: Principal's office (not Silicon Valley)
 * Typography: Tabular mono for numbers, clean sans for labels
 * Spacing: Dense but breathable — more info per screen
 */

export const tokens = {
  // Palette
  color: {
    ground: '#F8F9FA',
    ink: '#1A1D1F',
    inkMuted: '#6B7280',
    accent: '#DC2626',      // Red — "needs attention" ONLY
    positive: '#059669',    // Green — "all clear" ONLY
    warning: '#D97706',     // Amber — "watch this"
    border: '#E5E7EB',
    borderSubtle: '#F3F4F6',
  },

  // Typography
  font: {
    display: '"SF Mono", "Consolas", "JetBrains Mono", monospace',
    body: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  // Type Scale
  fontSize: {
    hero: '48px',       // Attendance %
    metric: '24px',     // Block metrics
    blockTitle: '14px', // Section headers
    label: '12px',      // Row labels
    body: '13px',       // Row text
    small: '11px',      // Timestamps, footnotes
  },

  fontWeight: {
    bold: 700,
    semibold: 600,
    medium: 500,
    regular: 400,
  },

  // Spacing
  space: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
  },

  // Border Radius
  radius: {
    sm: '6px',
    md: '8px',
    lg: '12px',
  },

  // Breakpoints
  breakpoint: {
    mobile: '380px',
    tablet: '768px',
    desktop: '1024px',
  },
} as const

/**
 * Status colours (semantic, not decorative).
 *
 * CHUNK 10. Two things were wrong here and both were invisible.
 *
 * `attendanceColor` banded at 75 while the thresholds module — and every other
 * screen — flags below 80. Third site found with that same disagreement, after
 * NeedsAttentionBlock and ClassWatchlist. The alert band now comes from the
 * module; only the "comfortable" stop above it is a display choice.
 *
 * And `value: number` accepted null happily, because strictNullChecks is off.
 * `null < 75` is TRUE in JavaScript, so a metric nobody had measured rendered in
 * ALERT RED — an unmarked register shown as an emergency. null is now neutral,
 * which is what "we do not know" should look like.
 */
export function statusColor(
  value: number | null | undefined,
  thresholds: { low: number; medium: number },
): string {
  if (value === null || value === undefined) return tokens.color.inkMuted
  if (value < thresholds.low) return tokens.color.accent
  if (value < thresholds.medium) return tokens.color.warning
  return tokens.color.positive
}

// Attendance-specific color
export function attendanceColor(pct: number | null | undefined): string {
  return statusColor(pct, { low: ATTENDANCE_LOW, medium: ATTENDANCE_COMFORTABLE })
}

// Homework-specific color
export function homeworkColor(pct: number | null | undefined): string {
  return statusColor(pct, { low: HOMEWORK_LOW, medium: HOMEWORK_COMFORTABLE })
}

// Chunk 10 batch 4: these were declared here. They are the upper colour stops of
// the attendance and homework ladders, and the ladders now live in one module —
// @/academic/metrics/bands — so a screen cannot band a figure differently from
// the screen beside it. Imported at the top of this file.

// Time ago formatting (principal-friendly, not social-media)
export function timeAgo(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Days waiting (for decision items)
export function daysWaiting(timestamp: string): number {
  return Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000)
}
