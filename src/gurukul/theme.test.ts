import { readFileSync, readdirSync } from "node:fs";
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
 * These tests do not ban the pattern outright — the theme still uses it in
 * ~30 places for its looks (glass, badge, stat …), which the second half of
 * the rewrite takes on (docs/TODO.md E1). They ban the two substrings that
 * collide with library-generated class names.
 *
 * The legacy dark colour vocabulary (`text-white`, `bg-white/10`,
 * `text-rose-300` …) is no longer re-skinned here at all: it was rewritten to
 * the tokens at source on 2026-10-10, and the last block below stops it
 * coming back — with no translation rule left, it would render raw.
 */

/** The admin, parent, principal and teacher panels' stylesheets went with
 *  the organisation side to the `organisation` branch (2026-10-01). */
const THEMES = [
  join("src", "gurukul", "theme.css"),
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

  it("and the theme still selects this way somewhere (control)", () => {
    // If this drops to zero, the assertions above have stopped proving
    // anything because the files no longer contain attribute selectors at all.
    const total = files.reduce((n, f) => n + (f.css.match(/\[class\*=/g) ?? []).length, 0);
    expect(total).toBeGreaterThan(20);
  });
});

/**
 * The legacy dark colour vocabulary, which theme.css used to translate to the
 * tokens at render time. Rewritten at source on 2026-10-10 (docs/TODO.md E1,
 * measured identical in a browser except the indigo the palette ruling bans),
 * and the translations deleted — so one written now would render raw: white
 * text on a white card, pale amber on a light page.
 */
// Exactly the families theme.css translated (text-rose-400 and text-sky-300
// it never did; they render raw today too — KNOWN_ISSUES 128).
const LEGACY = /(^|[\s"'`])(hover:|focus:)?(text-white|bg-white\/\d+|border-white\/\d+|text-rose-(200|300)|text-emerald-(200|300|400)|text-violet-(300|400)|text-amber-(300|400)|text-blue-(300|400))(\/\d+)?(?=[\s"'`]|$)/m;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the legacy dark colour classes are gone from the app (E1)", () => {
  const files = sourceFiles(join(process.cwd(), "src"));

  it("reads the whole app (control)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no component asks for one", () => {
    const offenders = files.flatMap((f) => {
      const m = readFileSync(f, "utf8").match(LEGACY);
      return m ? [`${f}: ${m[0].trim()}`] : [];
    });
    expect(offenders, `use the token instead (text-foreground, bg-muted, border-border, text-destructive, text-success, text-warning, text-primary):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("CONTROL: the pattern catches each family, and not the tokens", () => {
    for (const bad of ['"text-white"', '"p-2 bg-white/10"', '"border-white/5 x"', '"text-rose-300"', '"text-emerald-400/80"', '"hover:text-white"', '"text-violet-400"']) {
      expect(LEGACY.test(bad), bad).toBe(true);
    }
    for (const good of ['"text-foreground"', '"bg-muted"', '"text-destructive"', '"text-primary-foreground"', '"bg-rose-500/10"', '"text-white-space"']) {
      expect(LEGACY.test(good), good).toBe(false);
    }
  });

  it("and theme.css translates none of them any more", () => {
    const css = stripComments(readFileSync(join(process.cwd(), "src", "gurukul", "theme.css"), "utf8"));
    expect(css).not.toMatch(/text-white|bg-white|border-white|text-(rose|emerald|violet|amber|blue)-\d/);
    expect(css).not.toMatch(/\[class\*="(bg|text|border)-\[#/);
  });
});
