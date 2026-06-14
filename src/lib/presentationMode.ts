/**
 * Presentation mode — demo-ready student panel visuals.
 * Set to `false` before production to hide static enrichments.
 */
export const PRESENTATION_MODE = true;

/** Prefer live data; use demo fallback only when presentation mode is on and live is sparse. */
export function withPresentationFallback<T>(
  live: T[],
  demo: T[],
  minCount = 1,
): T[] {
  if (!PRESENTATION_MODE) return live;
  if (live.length >= minCount) return live;
  return demo;
}

/** Single-value fallback for nullable presentation fields. */
export function presentationValue<T>(live: T | null | undefined, demo: T): T {
  if (!PRESENTATION_MODE) return live ?? demo;
  if (live == null || live === 0 || live === "") return demo;
  return live;
}
