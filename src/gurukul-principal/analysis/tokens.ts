/**
 * Design Tokens for Class Analysis Page
 * §8 Visual Direction - defined once, used everywhere
 */

export const PALETTE = {
  ground: '#FAFAFA',        // Light neutral ground
  ink: '#1A1A1A',           // Primary text
  inkMuted: '#6B7280',      // Labels and secondary text
  accent: '#DC2626',        // Needs attention (red-600)
  positive: '#059669',      // Above threshold (emerald-600)
  warning: '#D97706',       // Approaching threshold (amber-600)
  border: '#E5E7EB',        // Structural borders (gray-200)
  hover: '#F3F4F6',         // Hover states (gray-100)
  faint: '#F9FAFB',         // Very subtle backgrounds
} as const;

export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
} as const;

/**
 * Typography styles with tabular numerals for alignment
 */
export const TYPE = {
  figure: {
    fontFamily: '"Inter", system-ui, sans-serif',
    fontFeatureSettings: '"tnum" 1, "lnum" 1',  // Tabular + lining nums
    fontVariantNumeric: 'tabular-nums',
  },
  comparison: {
    fontWeight: 500,
    opacity: 0.7,
  },
} as const;
