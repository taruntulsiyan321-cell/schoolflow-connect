import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The student panel had a SHADOW PALETTE: 155 raw hex colours living alongside
 * the theme tokens, each one a lighter twin of a token that already existed.
 *
 *     #4b9fd4  vs  --info         #4aa87a  vs  --success
 *     #c08a3a  vs  --warning      #cc5069  vs  --destructive
 *     #3b5bdb  vs  --primary
 *
 * It was not a style preference. Measured in the browser with a WCAG contrast
 * probe (e2e/diag-contrast.spec.ts), the hex values FAILED readability where
 * the tokens pass — "Events" 2.52:1, "100% overall" 2.53:1, "0 pending" 2.61:1,
 * "46% accuracy" 2.68:1, all against a 3:1 floor.
 *
 * And theme.css had grown a pile of `[class*="bg-[#3b5bdb]"]`-style rules to
 * paper over it, remapping the shadow palette back onto the tokens at render
 * time. Those substring selectors are the single most expensive defect shape in
 * this panel's history: they ate a lucide icon (`[class*="chart"]` matched 112
 * elements), blanked the "All" tab (a `/15` tint matched the solid-button
 * rule), and repainted every chat avatar's initial dark-on-dark.
 *
 * The palette is gone from `src/gurukul` source now. This is what stops it
 * coming back one component at a time.
 */

const BANNED: Record<string, string> = {
  "#3b5bdb": "--primary",
  "#6882e8": "--primary",
  "#818cf8": "--primary",
  "#6366f1": "--primary",
  "#4338ca": "--primary",
  "#c08a3a": "--warning",
  "#f59e0b": "--warning",
  "#fb923c": "--warning",
  "#cc5069": "--destructive",
  "#4aa87a": "--success",
  "#4b9fd4": "--info",
  "#60a5fa": "--info",
  "#78788c": "--muted-foreground",
  "#a0aec0": "--muted-foreground",
  "#b0b0c0": "--muted-foreground",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(join(process.cwd(), "src", "gurukul"));

describe("the student panel uses tokens, not a shadow palette", () => {
  it("scans a real, non-empty set of files (control)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no component hard-codes a colour the theme already names", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        // The removal records and doc comments name these hexes deliberately.
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        for (const [hex, token] of Object.entries(BANNED)) {
          if (code.toLowerCase().includes(hex)) {
            offenders.push(`${file}:${i + 1}  ${hex} → use ${token}\n    ${code.slice(0, 100)}`);
          }
        }
      });
    }
    expect(
      offenders,
      `these are the theme's own colours, spelled a second, lighter way:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: the same scan does find a string that IS present", () => {
    // Without this, a broken walk or a typo'd hex list makes the assertion
    // above pass no matter what the source contains. The needle is a token
    // reference rather than a hex, because after this pass there are no banned
    // hexes left to find — and a control that can only pass while the defect
    // exists is a control that stops working the moment you fix it.
    const needle = "hsl(var(--primary))";
    const hits = files.filter((f) => readFileSync(f, "utf8").includes(needle));
    expect(
      hits.length,
      `the scanner should be able to find a known-present colour string — if this is 0, ` +
        `the check above is passing because it reads nothing, not because the panel is clean`,
    ).toBeGreaterThan(3);
  });

  it("and alpha is applied with withAlpha, never by string concatenation", () => {
    // `${color}15` only yields a colour when `color` is a bare 6-digit hex.
    // Every colour here is a complete CSS colour now — `hsl(var(--info))`,
    // `var(--color-math)` — so the concatenation produces `hsl(var(--info))15`,
    // which is not a colour and is dropped at computed-value time. That is the
    // G4 "blank icon": a chip whose background silently vanished. 17 sites did
    // this, and the subject-coloured ones had been broken since the token work.
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        if (/\$\{[^}]*\}[0-9a-fA-F]{2}(?=[`\s,;)])/.test(code)) {
          offenders.push(`${file}:${i + 1}  ${code.slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      `use withAlpha(colour, 0.NN) — appending hex digits to a non-hex colour silently drops the declaration:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
