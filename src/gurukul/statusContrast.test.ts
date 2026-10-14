/**
 * A status colour as text on its own tint reads at least 4.5:1 (WCAG AA, small
 * text): the badge shape, `bg-warning/10 text-warning`, over a card.
 *
 * Measured 2026-10-10 (KNOWN_ISSUES 128 item 3): on a 10% tint, warning read
 * 4.29:1 and success 4.48:1. Stronger tints are in use too, `/15` badges and
 * a `/20` hover, where destructive read 4.09:1 and info 4.47:1 on `/15`. The
 * tints checked here are the ones the source pairs with the colour's own text,
 * found by reading it, so a new stronger tint fails until its colour clears it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const STATUS = ["warning", "success", "destructive", "info", "primary"] as const;
type Status = (typeof STATUS)[number];
type Hsl = [number, number, number];

/** A block's `--name: H S% L%;` values, from the first block the selector opens. */
function tokens(file: string, selector: string): Record<string, Hsl> {
  const css = readFileSync(join(ROOT, file), "utf8");
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found in ${file}`);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, Hsl> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const ROOT_TOKENS = tokens("src/index.css", ":root");
const PANEL_TOKENS = tokens("src/gurukul/theme.css", ".gurukul-student");

const rgb = ([h, s, l]: Hsl) => {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12, a = S * Math.min(L, 1 - L);
  return [0, 8, 4].map((n) => 255 * (L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
};
const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (top: number[], alpha: number, under: number[]) => top.map((v, i) => v * alpha + under[i] * (1 - alpha));

/**
 * The card a badge sits on, as the panel paints it: a GlassCard is the card
 * colour at 75% over the page at its thinnest (theme.css `[class*="glass"]`).
 * That is the darkest card surface, so the worst case for dark text. Measured
 * in Chromium 2026-10-14, `[class*="bg-card"]`'s gradient ends at #fcfdfd, a
 * shade lighter than this. Against pure white, warning on its 15% tint read
 * 4.56 and drew 4.48.
 */
const surface = (t: Record<string, Hsl>) => blend(rgb(t.card), 0.75, rgb(t.background));

/** The colour as text on its own tint at `alpha`, over the card surface. */
const onOwnTint = (hsl: Hsl, alpha: number, under = surface(PANEL_TOKENS)) => {
  const c = rgb(hsl);
  return contrast(c, blend(c, alpha, under));
};

/** Every tint the source pairs with the same colour's text in one class string, as alphas per colour. */
function tintsInUse(): Record<Status, number[]> {
  const out = Object.fromEntries(STATUS.map((s) => [s, [] as number[]])) as Record<Status, number[]>;
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
    });
  for (const file of walk(join(ROOT, "src"))) {
    for (const lit of readFileSync(file, "utf8").match(/["'`][^"'`\n]*["'`]/g) ?? []) {
      for (const s of STATUS) {
        if (!new RegExp(`(^|[\\s"'\`:])text-${s}(?![-\\w/])`).test(lit)) continue;
        for (const m of lit.matchAll(new RegExp(`bg-${s}/(\\d+)`, "g"))) out[s].push(Number(m[1]) / 100);
      }
    }
  }
  return out;
}


describe("status colours on their own tints", () => {
  const inUse = tintsInUse();

  it("finds the badge tints in the source (the survey reads something)", () => {
    expect(inUse.warning).toContain(0.1);
    expect(inUse.success).toContain(0.15);
    expect(Math.max(...inUse.destructive)).toBeGreaterThanOrEqual(0.2);
  });

  for (const s of STATUS) {
    it(`${s}: text on the strongest of its tints in use reads at least 4.5:1, in both homes, and the homes agree`, () => {
      expect(PANEL_TOKENS[s], `the panel scope and :root disagree on --${s}`).toEqual(ROOT_TOKENS[s]);
      const strongest = Math.max(0.1, ...inUse[s]);
      expect(onOwnTint(ROOT_TOKENS[s], strongest), `--${s} on its ${strongest * 100}% tint`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("CONTROL: the colours as they stood fail it", () => {
    expect(onOwnTint([35, 68, 36], 0.1)).toBeLessThan(4.5); // warning: 4.29
    expect(onOwnTint([161, 46, 33], 0.1)).toBeLessThan(4.5); // success: 4.48
    expect(onOwnTint([1, 37, 48], 0.2)).toBeLessThan(4.5); // destructive on its hover: 4.09
    expect(onOwnTint([192, 52, 34], 0.15)).toBeLessThan(4.5); // info: 4.47
  });
});
