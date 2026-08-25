/**
 * Principal Panel Palette - Part F.2
 *
 * Eight values. No ninth. No blue anywhere.
 */

export const PALETTE = {
  ground: '#FAFAF8',      // Page background
  surface: '#FFFFFF',     // Content areas
  ink: '#1A1D21',         // Primary text and figures
  inkMuted: '#6B7280',    // Labels, comparison, —
  border: '#E5E5E0',      // Rules and dividers
  alert: '#B42318',       // Breached threshold, overdue only
  alertBg: '#FEF3F2',     // Flagged cell background
  positive: '#067647',    // Improvement deltas only
} as const

/**
 * Spacing scale - Part F.8
 * 4 / 8 / 12 / 16 / 24 / 32 only
 */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

/**
 * Typography scale - Part F.7
 */
export const TYPE = {
  heroFigure: { fontSize: 56, fontWeight: 600, color: PALETTE.ink },
  blockFigure: { fontSize: 32, fontWeight: 600, color: PALETTE.ink },
  contextBesideFigure: { fontSize: 13, fontWeight: 400, color: PALETTE.inkMuted },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: PALETTE.inkMuted, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  rowPrimary: { fontSize: 14, fontWeight: 500, color: PALETTE.ink },
  rowSecondary: { fontSize: 13, fontWeight: 400, color: PALETTE.inkMuted },
}

/**
 * Three-state formatting - Part 1
 */
export function formatValue(
  value: number | null | undefined,
  options?: { isPercent?: boolean; notMarked?: boolean }
): string {
  if (options?.notMarked) return 'Not marked'
  if (value === null || value === undefined) return '—'
  return options?.isPercent ? `${value}%` : String(value)
}

/**
 * Threshold guard - Part 1
 */
export function shouldFlag(
  value: number | null | undefined,
  threshold: number,
  recordCount: number = 1
): boolean {
  if (recordCount === 0) return false
  if (value === null || value === undefined) return false
  return value < threshold
}
