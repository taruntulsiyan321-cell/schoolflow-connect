import { test, expect } from "@playwright/test";

// The chromium project preloads the STUDENT storage state, so /auth redirects
// straight into the student panel and the sign-in form never renders. This spec
// needs a clean browser to sign in as somebody else.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Design survey of the PRINCIPAL panel.
 *
 * Signs in as the principal itself rather than reusing the student storage
 * state, so this file is self-contained and does not depend on which project
 * ran before it.
 *
 * It captures every screen and measures the things a design review needs to be
 * able to state as fact rather than impression: which fonts are actually
 * rendering, which radii, how many distinct colours are on screen, and whether
 * the two documented palettes are both live at once.
 */

const EMAIL = process.env.E2E_PRINCIPAL_EMAIL || "principal@wisdomcampus.com";
const PASSWORD = process.env.E2E_PRINCIPAL_PASSWORD || "DemoPass123!";

const SCREENS = [
  "/principal",
  "/principal",
  "/principal/teachers",
  "/principal/students",
  "/principal/classes",
  "/principal/exams",
  "/principal/attendance",
  "/principal/leaves",
  "/principal/cases",
  "/principal/announcements",
  "/principal/messages",
  "/principal/settings",
];

test("survey the principal panel", async ({ page }) => {
  test.setTimeout(900_000);

  await page.goto("/auth");
  await page.getByLabel("Email or Mobile").fill(EMAIL);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/principal/, { timeout: 30000 });

  const rows: unknown[] = [];

  for (const path of SCREENS) {
    await page.goto(path);
    await page.waitForTimeout(7000);

    const info = await page.evaluate(() => {
      const seen = {
        fontFamilies: new Map<string, number>(),
        radii: new Map<string, number>(),
        colors: new Map<string, number>(),
        backgrounds: new Map<string, number>(),
      };
      let textNodes = 0;
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => (n.textContent ?? "").trim())
          .join("")
          .trim();
        if (own) {
          textNodes++;
          const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
          seen.fontFamilies.set(fam, (seen.fontFamilies.get(fam) ?? 0) + 1);
          seen.colors.set(cs.color, (seen.colors.get(cs.color) ?? 0) + 1);
        }
        if (cs.borderRadius && cs.borderRadius !== "0px") {
          const rad = cs.borderRadius.split(" ")[0];
          seen.radii.set(rad, (seen.radii.get(rad) ?? 0) + 1);
        }
        if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") {
          seen.backgrounds.set(cs.backgroundColor, (seen.backgrounds.get(cs.backgroundColor) ?? 0) + 1);
        }
      }
      const top = (m: Map<string, number>, n = 8) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} x${v}`);
      return {
        chars: (document.body.innerText ?? "").length,
        h1: [...document.querySelectorAll("h1")].map((h) => (h.textContent ?? "").trim().slice(0, 40)),
        textNodes,
        fonts: top(seen.fontFamilies),
        radii: top(seen.radii),
        distinctTextColors: seen.colors.size,
        topColors: top(seen.colors, 6),
        distinctBackgrounds: seen.backgrounds.size,
        overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      };
    });

    rows.push({ path, ...info });
    await page.screenshot({ path: `test-results/principal${path.replace(/\//g, "_")}.png` });
    console.log(
      `${path.padEnd(30)} chars=${String(info.chars).padEnd(5)} h1=${info.h1.length} nodes=${String(info.textNodes).padEnd(4)} colors=${String(info.distinctTextColors).padEnd(3)} bgs=${String(info.distinctBackgrounds).padEnd(3)} overflowX=${info.overflowX}`,
    );
    console.log(`   fonts: ${info.fonts.join(" | ")}`);
    console.log(`   radii: ${info.radii.join(" | ")}`);
  }

  console.log("\nFULL:\n" + JSON.stringify(rows, null, 2));

  // Control only — this is a survey, not a gate. It fails if the walk never
  // authenticated, because then every line above describes the login form.
  const thin = (rows as { path: string; chars: number }[]).filter((r) => r.chars < 200);
  expect(thin.map((r) => r.path), "screens that rendered almost nothing").toEqual([]);
});
