import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The panel had FIVE hand-rolled progress rings and they agreed on nothing —
 * three stroke widths, two track colours, and four different glow radii.
 *
 * THE GLOW. Four of them wrapped the arc in
 * `filter: drop-shadow(0 0 Npx <the arc's own colour>)` at full opacity. That
 * is a dark-theme idiom: on a dark ground, blurring a bright colour outward
 * reads as light. This panel is light, and the ring colours are deep — so
 * blurring `--warning` (a dark ochre) outward over white produced a brown
 * smudge around the weekly-sessions ring on Home. It looked like a shadow,
 * because that is exactly what it was.
 *
 * THE INVISIBLE TRACK. Two of them drew the unfilled part of the ring in
 * `rgba(255,255,255,0.06)` — white at 6% on a white card. A 75% arc had
 * nothing to be 75% OF.
 *
 * Both are structural, so both are guarded here rather than left to the next
 * person to notice by eye.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(join(process.cwd(), "src", "gurukul"));
const shared = readFileSync(
  join(process.cwd(), "src", "gurukul", "components", "shared.tsx"),
  "utf8",
);

/** Strip block and line comments — every one of these strings is named in a removal record. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the panel has one progress ring and it does not glow", () => {
  it("scans a real, non-empty set of files (control)", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(shared).toContain("export function ProgressRing");
  });

  it("no ring paints a coloured glow around its own stroke", () => {
    const offenders: string[] = [];
    for (const file of files) {
      code(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          // `drop-shadow` with an interpolated colour is the shape: a glow the
          // same colour as the thing it surrounds. A flat rgba shadow for depth
          // is a different thing and stays allowed.
          if (/drop-shadow\([^)]*\$\{/.test(line)) {
            offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(
      offenders,
      `a coloured drop-shadow around a stroke is a dark-theme glow; on this light panel it smudges:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no ring track is painted in white-on-white", () => {
    const offenders: string[] = [];
    for (const file of files) {
      code(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+\s*\)/.test(line)) {
            offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(
      offenders,
      `translucent white is invisible on this panel's cards — use hsl(var(--border)):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the shared ring draws a gradient, a visible track, and no filter", () => {
    const body = shared.slice(shared.indexOf("export function ProgressRing"));
    const ring = body.slice(0, body.indexOf("\nexport function", 10));
    expect(ring, "the arc should be a gradient, not a flat stroke").toContain("linearGradient");
    expect(ring).toContain("stroke={`url(#${gradientId})`}");
    expect(ring, "the track must be visible on a light card").toContain('stroke="hsl(var(--border))"');
    expect(ring, "the gradient must not go transparent over the track").toContain("withTint(");
    expect(ring, "no glow").not.toContain("drop-shadow");
    // A gradient id must be unique per instance or two rings on one screen
    // silently share the first one's colour.
    expect(ring).toContain("useId()");
  });

  it("every screen that shows a ring uses the shared one", () => {
    // POSITIVE CONTROL first: this only means something if rings are actually
    // in use.
    //
    // The floor was 4 and is now 3. Revision.tsx was the fourth, in a
    // RevResults component that rendered a ring for a revision score — and
    // that component was unreachable: nothing ever set the page's view to
    // "results", so `activeItem` was never non-null. It came out with the
    // rest of the dead view machinery when Revision moved onto the 7C engine.
    //
    // Three is still a real control: it proves the shared ring has multiple
    // live consumers, which is what stops the "nobody hand-rolls one" half
    // below from passing vacuously over a component nothing renders.
    const users = files.filter(
      (f) => !f.endsWith(join("components", "shared.tsx")) && readFileSync(f, "utf8").includes("<ProgressRing"),
    );
    expect(users.length, "screens rendering the shared ring").toBeGreaterThanOrEqual(3);

    // And nobody hand-rolls a new one. A stroke-dasharray circle IS a ring.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(join("components", "shared.tsx"))) continue;
      const src = code(readFileSync(file, "utf8"));
      if (/strokeDasharray=\{c\}|strokeDashoffset=\{offset\}/.test(src)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `use <ProgressRing> instead of drawing another dash-offset circle:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
