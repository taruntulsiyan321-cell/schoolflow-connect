import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withAlpha } from "./colorAlpha";

/**
 * G4 — the blank icons — and the guard that keeps them gone.
 *
 * The theme carries two token shapes that are indistinguishable as strings:
 *
 *     --primary:        193 68% 28%        a triplet, needs hsl() around it
 *     --color-physics:  hsl(197 70% 40%)   already a complete colour
 *
 * The render layer built `hsl(${color})` for both, which yields
 * `hsl(hsl(197 70% 40%))` for the second — not a colour, so the declaration is
 * dropped and the property inherits. Measured in the browser inside
 * `.gurukul-student`, 2026-09-11:
 *
 *     BEFORE  icon rgb(14,30,37) = inherited     background rgba(0,0,0,0)
 *     AFTER   icon rgb(31,133,173)               background srgb .12 .52 .68 / .1
 *
 * The rule that replaced it: every colour is stored as a COMPLETE CSS colour,
 * and alpha goes through `withAlpha`. These tests hold both halves.
 */

describe("withAlpha", () => {
  it("puts alpha on a triplet-token colour", () => {
    expect(withAlpha("hsl(var(--primary))", 0.1)).toBe(
      "color-mix(in srgb, hsl(var(--primary)) 10%, transparent)",
    );
  });

  it("puts alpha on an already-complete token colour — the case that used to be dropped", () => {
    // The old implementation returned this string UNCHANGED, silently losing
    // the alpha, because it only understood values starting with `hsl(`.
    expect(withAlpha("var(--color-physics)", 0.1)).toBe(
      "color-mix(in srgb, var(--color-physics) 10%, transparent)",
    );
  });

  it("handles a hex colour, which six pages pass as a fallback", () => {
    expect(withAlpha("#3b5bdb", 0.08)).toBe("color-mix(in srgb, #3b5bdb 8%, transparent)");
  });

  it("clamps out-of-range alpha rather than emitting an invalid percentage", () => {
    expect(withAlpha("#fff", 1.7)).toBe("color-mix(in srgb, #fff 100%, transparent)");
    expect(withAlpha("#fff", -2)).toBe("color-mix(in srgb, #fff 0%, transparent)");
  });

  it("returns an empty string untouched instead of building color-mix around nothing", () => {
    expect(withAlpha("", 0.5)).toBe("");
  });
});

/** Every .tsx/.ts under a directory, so the guard cannot miss a new file. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

describe("the student render layer never wraps a colour in hsl() again", () => {
  const files = walk(join(process.cwd(), "src", "gurukul"));

  it("scans a real, non-empty set of files (control)", () => {
    // Without this, a broken walk() would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it("contains no `hsl(${...})` template wrap outside comments", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("*") || code.startsWith("//")) return;
          if (code.includes("hsl(${")) offenders.push(`${file}:${i + 1}  ${code.slice(0, 90)}`);
        });
    }
    expect(offenders, `wrap a stored colour in hsl() and the --color-* family renders invalid:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("stores no bare triplet token as a colour value", () => {
    // `color: "var(--primary)"` is a triplet, not a colour. It only ever worked
    // because something downstream wrapped it, which is the coupling that broke.
    const TRIPLET = /(?:color|colorVar|stroke|fill|background)\s*[=:]\s*"var\(--(?:primary|accent|warning|success|info|destructive|muted-foreground|secondary|primary-glow|foreground|border)\)"/;
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("*") || code.startsWith("//")) return;
          if (TRIPLET.test(code)) offenders.push(`${file}:${i + 1}  ${code.slice(0, 90)}`);
        });
    }
    expect(offenders, `store the complete colour instead — hsl(var(--x)):\n${offenders.join("\n")}`).toEqual([]);
  });
});
