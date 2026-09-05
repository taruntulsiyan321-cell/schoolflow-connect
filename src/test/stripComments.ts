/**
 * RULE 29 — a guard that matches a body must strip comments first.
 *
 * Source assertions read a file (or a function's `toString()`) and assert that
 * an identifier is absent. Comments are part of that text, so a comment
 * EXPLAINING why the identifier was removed re-introduces it and fails a
 * correct change. That cost two sessions over `examAvg`, in `f6e2f51` and again
 * in `1ec1628`.
 *
 * The reverse is worse: a guard asserting an identifier is PRESENT is satisfied
 * by a comment mentioning it, so a genuinely unguarded body passes as safe.
 *
 * Ported from `stripComments()` in `scripts/lint-render-safety.mjs`, which is
 * the canonical implementation. Comment bodies are replaced with spaces rather
 * than deleted so line and column offsets survive — a matcher that reports a
 * position still reports the right one.
 *
 * Deliberately NOT a full parser. It does not understand strings, so a `//`
 * inside a string literal is treated as a comment. For absence assertions that
 * is the safe direction: it can only remove more text, never invent a match.
 * The `[^:]` guard before `//` keeps `https://` intact, which is the one case
 * common enough in this codebase to matter.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1: string) =>
      p1 + " ".repeat(Math.max(0, m.length - p1.length)),
    );
}
