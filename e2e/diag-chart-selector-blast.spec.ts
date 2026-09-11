import { test, expect } from "@playwright/test";

/**
 * Blast radius of `.gurukul-student [class*="chart"], [class*="graph"]`.
 *
 * The selector was written for chart CONTAINERS. It is a substring match on the
 * whole class attribute, so it also hits:
 *   - every lucide icon named `lucide-chart-*`
 *   - every recharts internal element (`recharts-wrapper`, `recharts-surface`,
 *     `recharts-layer`, …) — all of which contain "chart"
 *
 * On a 24px icon, `padding: 1rem` under border-box floors the used width at
 * 32px and collapses the content box to 0x0 — the svg gets no viewport, so it
 * paints nothing, and the white gradient the rule applies is the pale square
 * that shows instead.
 */
const PAGES = ["", "learning", "analysis", "practice", "battleground"];

test("how many elements does the chart selector hit", async ({ page }) => {
  let grand = 0;
  for (const p of PAGES) {
    await page.goto(`/student/${p}`);
    await expect(page).toHaveURL(/\/student/);
    await page.waitForTimeout(3500);

    const hits = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[class*="chart"],[class*="graph"]')];
      const byKind: Record<string, number> = {};
      const icons: string[] = [];
      for (const el of els) {
        const cls = el.getAttribute("class") ?? "";
        const kind = cls.includes("lucide")
          ? "LUCIDE ICON"
          : cls.includes("recharts")
            ? "recharts internal"
            : "other";
        byKind[kind] = (byKind[kind] ?? 0) + 1;
        if (kind === "LUCIDE ICON") icons.push(cls.replace("lucide ", "").split(" ")[0]);
      }
      return { total: els.length, byKind, icons: [...new Set(icons)] };
    });

    grand += hits.total;
    console.log(
      `/student/${(p || "(home)").padEnd(13)} matched=${String(hits.total).padEnd(4)} ${JSON.stringify(hits.byKind)}`,
    );
    if (hits.icons.length) console.log(`                       broken icons: ${hits.icons.join(", ")}`);
  }

  console.log(`\nTOTAL ELEMENTS WRONGLY STYLED ACROSS ${PAGES.length} SCREENS: ${grand}`);
  // Positive control: the selector really does match things — if it matched
  // nothing, this whole diagnosis would be wrong.
  expect(grand, "selector matched nothing — the diagnosis is wrong").toBeGreaterThan(0);
});
