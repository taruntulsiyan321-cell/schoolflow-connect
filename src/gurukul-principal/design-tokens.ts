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

// Status colors (semantic, not decorative)
export function statusColor(value: number, thresholds: { low: number; medium: number }): string {
  if (value < thresholds.low) return tokens.color.accent
  if (value < thresholds.medium) return tokens.color.warning
  return tokens.color.positive
}

// Attendance-specific color
export function attendanceColor(pct: number): string {
  return statusColor(pct, { low: 75, medium: 85 })
}

// Homework-specific color
export function homeworkColor(pct: number): string {
  return statusColor(pct, { low: 60, medium: 75 })
}

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
