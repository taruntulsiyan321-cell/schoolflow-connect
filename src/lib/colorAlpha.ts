/**
 * Alpha on a colour, whatever shape the colour is in.
 *
 * ── WHY THIS IS NOT `hsl(${c} / a)` ANY MORE ─────────────────────────────
 *
 * This file used to slice the closing paren off an `hsl(...)` string and append
 * `/ a`, and return anything else UNCHANGED — silently dropping the alpha. That
 * worked only because it was fed one shape. The theme has two:
 *
 *     --primary:        193 68% 28%      a triplet, needs hsl() around it
 *     --color-physics:  hsl(197 70% 40%) a complete colour, must NOT be wrapped
 *
 * Measured in the browser inside `.gurukul-student`, 2026-09-11:
 *
 *     hsl(var(--primary))              -> rgb(23, 99, 120)   correct
 *     hsl(var(--color-physics))        -> rgb(14, 30, 37)    INHERITED, dropped
 *     hsl(var(--color-physics) / 0.1)  -> rgba(0, 0, 0, 0)   TRANSPARENT
 *     var(--color-physics)             -> rgb(31, 133, 173)  correct
 *
 * `hsl(hsl(197 70% 40%))` is not a colour, so the whole declaration is invalid
 * at computed-value time and the property falls back to inherit (colour) or the
 * initial value (background). That is the G4 "blank icon": a dark stroke on a
 * chip whose background had silently vanished, under `opacity-40`.
 *
 * Nothing at string level can tell `var(--primary)` from `var(--color-physics)`
 * — they are the same characters. So the fix is not a smarter sniffer. It is
 * that **every colour in this codebase is stored as a complete CSS colour** and
 * this helper never has to guess.
 *
 * `color-mix` handles every complete colour — `var(--x)`, `hsl(...)`, `#hex`,
 * `rgb(...)` — with one rule and no branch. Verified supported in the app's
 * engine before this was written, and verified to produce the same alpha for
 * both token families.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = String(color ?? "").trim();
  if (!c) return c;
  const pct = Math.max(0, Math.min(1, alpha)) * 100;
  return `color-mix(in srgb, ${c} ${pct}%, transparent)`;
}

/**
 * A LIGHTER version of a colour — mixed toward the surface it sits on, not
 * made transparent.
 *
 * `withAlpha` is the wrong tool when something is already painted underneath.
 * A progress ring draws its track first and its arc on top at the same radius,
 * so a translucent arc lets the grey track show through and the result is
 * muddy. Mixing toward the card keeps the arc opaque and still lets a gradient
 * run from pale to full.
 *
 * `amount` is how much of the ORIGINAL colour survives: 0.5 is a half-strength
 * tint, 1 is the colour untouched.
 */
export function withTint(color: string, amount: number, surface = "hsl(var(--card))"): string {
  const c = String(color ?? "").trim();
  if (!c) return c;
  const pct = Math.max(0, Math.min(1, amount)) * 100;
  return `color-mix(in srgb, ${c} ${pct}%, ${surface})`;
}
