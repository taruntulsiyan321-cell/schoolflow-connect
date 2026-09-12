import { test, expect } from "@playwright/test";

/**
 * Finds text a student cannot read.
 *
 * The Fees hero was the case that prompted this: it hard-coded a near-black
 * green background and then set every line inside it with `text-foreground/70`,
 * and `--foreground` in this theme is a near-black navy. Dark ink on a dark
 * ground, shipped, on the screen that tells a family what they owe. Reading the
 * source would not have caught it — the class names look perfectly reasonable
 * on their own, and only the computed pair is wrong.
 *
 * So this walks the rendered panel and computes the real WCAG contrast ratio of
 * every visible text node against the first opaque background behind it.
 *
 * THRESHOLD: 3.0, not 4.5. This is a defect net, not an accessibility audit —
 * it is aimed at text that is effectively invisible, and a stricter bar would
 * bury that signal under every piece of legitimately soft secondary text in the
 * panel. Raising it to WCAG AA is a separate, much larger pass.
 */

const SCREENS = [
  "/student",
  "/student/fees",
  "/student/chat",
  "/student/classes",
  "/student/tests",
  "/student/attendance",
  "/student/profile",
  "/student/analysis",
  "/student/timetable",
  "/student/calendar",
  "/student/notifications",
  "/student/learning",
  "/student/class",
  "/student/battleground",
];

const MIN_RATIO = 3.0;

test("no student screen renders text that cannot be read", async ({ page }) => {
  test.setTimeout(600_000);
  const findings: string[] = [];
  const perScreen: { path: string; checked: number }[] = [];
  let totalChecked = 0;

  for (const path of SCREENS) {
    await page.goto(path);
    await page.waitForTimeout(7000);

    const result = await page.evaluate((minRatio) => {
      function parse(c: string): [number, number, number, number] | null {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(",").map((v) => parseFloat(v.trim()));
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      }
      function lum([r, g, b]: number[]) {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      }
      function over(fg: number[], bg: number[]) {
        const a = fg[3];
        return [
          fg[0] * a + bg[0] * (1 - a),
          fg[1] * a + bg[1] * (1 - a),
          fg[2] * a + bg[2] * (1 - a),
          1,
        ];
      }
      /**
       * First opaque background painted behind an element, or null if a
       * gradient is in the way.
       *
       * The `background` SHORTHAND resets `background-color` to transparent
       * when it sets a gradient, and theme.css paints every primary button with
       * `background: linear-gradient(...)`. So a naive walk reads the button as
       * transparent, skips past it to the page behind, and reports white
       * button text as unreadable — which is how this probe's first run
       * "found" the selected day on Timetable and the active tab on Classes,
       * both of which are plainly legible on screen.
       *
       * A gradient's contrast cannot be reduced to one pair of colours, so
       * these are reported as unmeasurable rather than guessed at either way.
       */
      function bgOf(el: Element): number[] | null {
        let node: Element | null = el;
        const stack: number[][] = [];
        // How much of the view is already painted by the layers collected so
        // far. A gradient only matters while something is still see-through.
        let covered = 0;
        while (node) {
          const cs = getComputedStyle(node);
          if (cs.backgroundImage && cs.backgroundImage !== "none") {
            // The page itself has a gradient ground, and nearly every card
            // above it is `bg-card/95`. Bailing on ANY gradient anywhere in the
            // ancestor chain therefore blinded this probe almost completely —
            // 61 of 66 text nodes on Home went unmeasured. It only matters when
            // the gradient is still visible through what is stacked above it.
            if (covered >= 0.9) break;
            return null;
          }
          const c = parse(cs.backgroundColor);
          if (c && c[3] > 0) {
            stack.push(c);
            covered = covered + (1 - covered) * c[3];
            if (covered >= 0.999) break;
          }
          node = node.parentElement;
        }
        let base = [255, 255, 255, 1];
        for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
        return base;
      }

      const out: { text: string; ratio: number; color: string; bg: string; tag: string }[] = [];
      let checked = 0;
      let skippedGradient = 0;
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => (n.textContent ?? "").trim())
          .join(" ")
          .trim();
        if (!own) continue;
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.15) continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = bgOf(el);
        if (!bg) {
          skippedGradient++;
          continue;
        }
        const solidFg = over(fg, bg);
        const l1 = lum(solidFg);
        const l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        checked++;
        if (ratio < minRatio) {
          out.push({
            text: own.slice(0, 60),
            ratio: Math.round(ratio * 100) / 100,
            color: cs.color,
            bg: `rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`,
            tag: el.tagName.toLowerCase(),
          });
        }
      }
      return { out, checked, skippedGradient };
    }, MIN_RATIO);

    totalChecked += result.checked;
    perScreen.push({ path, checked: result.checked });
    for (const f of result.out) {
      findings.push(`${path}  ${f.ratio}:1  <${f.tag}> "${f.text}"  ${f.color} on ${f.bg}`);
    }
    // The gradient count is printed rather than hidden: it is coverage this
    // probe does NOT have, and a silent skip reads as a clean result.
    console.log(
      `${path.padEnd(26)} checked=${String(result.checked).padEnd(4)} failing=${String(result.out.length).padEnd(3)} onGradient(unmeasured)=${result.skippedGradient}`,
    );
  }

  // Findings print FIRST, unconditionally.
  //
  // The coverage control below used to run before this and it swallowed a real
  // result: a run that found 31 genuine defects failed on coverage instead and
  // printed none of them. A control exists to stop an EMPTY result being
  // mistaken for a clean one — it has no business hiding a non-empty one.
  if (findings.length) console.log("\nFINDINGS:\n" + findings.join("\n"));

  expect(findings, `text below ${MIN_RATIO}:1 contrast:\n${findings.join("\n")}`).toEqual([]);

  // POSITIVE CONTROL, and it only matters now that `findings` is empty: an auth
  // bounce, or a walk that measured nothing, produces exactly the same empty
  // array as a genuinely clean panel.
  //
  // The bar is coverage-aware. Gradient backgrounds are unmeasurable by
  // construction (see `bgOf`) and this panel paints a lot of them, so the
  // useful question is not "were many nodes measured" but "did most screens
  // yield something".
  const blindScreens = perScreen.filter((s) => s.checked === 0).map((s) => s.path);
  expect(
    blindScreens,
    `these screens yielded no measurable text at all, so a clean result says nothing about them:\n${blindScreens.join("\n")}`,
  ).toEqual([]);
  expect(
    totalChecked,
    `only ${totalChecked} text nodes were measurable across ${SCREENS.length} screens; too few to call the panel clean.`,
  ).toBeGreaterThan(300);
});
