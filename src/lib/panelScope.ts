/**
 * Which panel's design a node is rendered under.
 *
 * Each panel puts its tokens on a scope class at its shell root — the whole
 * design system for the staff panels lives in `.gurukul-principal,
 * .gurukul-teacher, .gurukul-parent` — so anything rendered inside that subtree
 * inherits the right colours and fonts for free.
 *
 * Anything portaled to `document.body` does not. A modal that escapes the shell
 * to clear its stacking contexts also escapes the token scope, and every
 * `bg-card`, `text-foreground` and `--font-body` inside it then resolves against
 * the `:root` block in index.css instead of the panel on screen. Measured on the
 * parent panel, the portaled new-chat sheet rendered in Plus Jakarta Sans on
 * rgb(243, 246, 246) — index.css's `--background` — behind a panel drawn in Work
 * Sans on warm cream.
 *
 * So a portaled surface reads its opener's scope with `panelScopeOf` and puts it
 * back on the portaled root. One definition, because the list of scopes is the
 * kind of thing that rots when it is copied.
 */

/**
 * Spelled out rather than matched as a substring. `[class*="gurukul-"]` reads
 * the same and is the single most expensive selector shape in this codebase: it
 * matches any element whose class attribute merely contains the text.
 */
export const PANEL_SCOPES = [
  "gurukul",
  "gurukul-admin",
  "gurukul-parent",
  "gurukul-principal",
  "gurukul-teacher",
] as const;

/** The scope class `node` sits under, or "" when it is under none. */
export function panelScopeOf(node: Element | null): string {
  const host = node?.closest(PANEL_SCOPES.map((s) => `.${s}`).join(","));
  return PANEL_SCOPES.find((s) => host?.classList.contains(s)) ?? "";
}
