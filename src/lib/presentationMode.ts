/**
 * Presentation mode — static demo enrichments for student panel.
 * Must stay `false` in product builds. Never invent academic stats when live data is sparse.
 */
export const PRESENTATION_MODE = false;

/** Prefer live data only. Demo fallbacks are disabled while PRESENTATION_MODE is false. */
export function withPresentationFallback<T>(
  live: T[],
  demo: T[],
  minCount = 1,
): T[] {
  if (!PRESENTATION_MODE) return live;
  if (live.length >= minCount) return live;
  return demo;
}

/**
 * Single-value fallback. When presentation mode is off, returns live as-is
 * (including null / 0 / "") — never substitutes demo values.
 */
export function presentationValue<T>(live: T | null | undefined, demo: T): T | null | undefined {
  if (!PRESENTATION_MODE) return live;
  if (live == null || live === 0 || live === "") return demo;
  return live;
}
