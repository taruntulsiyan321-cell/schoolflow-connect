import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `[class*="…"]` is a SUBSTRING match on the whole class attribute, and this
 * codebase has now shipped two defects from exactly that.
 *
 *   1. `[class*="bg-primary"]` also caught `bg-primary/10` and friends —
 *      documented in theme.css around line 856.
 *   2. `[class*="chart"], [class*="graph"]` was written for chart CONTAINERS
 *      and instead matched every lucide icon named `lucide-chart-*` and every
 *      recharts internal. Measured live across five student screens: 112
 *      elements matched, ZERO of them intended.
 *
 *      What it did to a 24px icon: `padding: 1rem` is 32px of horizontal
 *      padding, and under border-box that floors the used width at 32px and
 *      collapses the CONTENT box to 0x0. The svg got a zero viewport and drew
 *      nothing; the pale square left behind was the rule's own white gradient.
 *      Home, Learning and Practice each shipped a blank icon because of it.
 *
 * These tests do not ban the pattern outright — the theme files use it
 * deliberately in ~40 places to re-skin legacy Tailwind colour classes. They
 * ban the two substrings that collide with library-generated class names.
 */

const THEMES = [
  join("src", "gurukul", "theme.css"),
  join("src", "gurukul-admin", "theme.css"),
  join("src", "gurukul-parent", "theme.css"),
  join("src", "gurukul-principal", "theme.css"),
  join("src", "gurukul-teacher", "theme.css"),
  join("src", "index.css"),
];

/** Strip comments: the removal notes quote the deleted selector on purpose. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");

describe("no attribute selector collides with library class names", () => {
  const files = THEMES.map((rel) => ({
    rel,
    css: stripComments(readFileSync(join(process.cwd(), rel), "utf8")),
  }));

  it("reads real stylesheets (control)", () => {
    // Without this, a bad path would make every assertion below vacuous.
    const braces = files.reduce((n, f) => n + (f.css.match(/\{/g) ?? []).length, 0);
    expect(files.length).toBe(THEMES.length);
    expect(braces).toBeGreaterThan(200);
  });

  it.each(["chart", "graph"])(
    'no rule selects on [class*="%s"] — lucide and recharts both generate class names containing it',
    (needle) => {
      const offenders: string[] = [];
      for (const f of files) {
        f.css.split("\n").forEach((line, i) => {
          if (line.includes(`[class*="${needle}`)) offenders.push(`${f.rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
        });
      }
      expect(
        offenders,
        `substring-matching "${needle}" hits lucide-chart-* icons and every recharts internal. Use a real class:\n${offenders.join("\n")}`,
      ).toEqual([]);
    },
  );

  it("and the panel still re-skins legacy colour classes this way (control)", () => {
    // The pattern itself is legitimate and widely used here. If this drops to
    // zero, the assertions above have stopped proving anything because the
    // files no longer contain attribute selectors at all.
    const total = files.reduce((n, f) => n + (f.css.match(/\[class\*=/g) ?? []).length, 0);
    expect(total).toBeGreaterThan(20);
  });
});
