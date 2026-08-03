/**
 * Presentation mode — static demo enrichments for student panel.
 * Must stay `false` in product builds. Never invent academic stats when live data is sparse.
 * Defense-in-depth: helpers always return live even if this flag is flipped by mistake.
 */
export const PRESENTATION_MODE = false;

/** Prefer live data only. Demo arrays are ignored in product builds. */
export function withPresentationFallback<T>(
  live: T[],
  _demo: T[],
  _minCount = 1,
): T[] {
  void _demo;
  void _minCount;
  // Always live — PRESENTATION_MODE must remain false; never inject demo fill.
  return live;
}

/**
 * Single-value fallback. Always returns live as-is (including null / 0 / "") —
 * never substitutes demo values in product builds.
 */
export function presentationValue<T>(live: T | null | undefined, _demo: T): T | null | undefined {
  void _demo;
  return live;
}
