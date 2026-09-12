import { test } from "@playwright/test";

/**
 * The OTHER half of the student panel.
 *
 * `src/gurukul/pages/` is the designed half — GlassCard, PageHeader, the
 * display face. `src/pages/student/` and `src/pages/shared/` are thirteen
 * screens a student reaches from those same menus, built against plain shadcn
 * Card with no page header and no shared vocabulary. A student crosses between
 * them constantly, so the panel changes identity mid-journey.
 *
 * This captures the ones reachable without a record id, so the gap can be
 * reviewed rather than assumed.
 */
const PATHS = [
  "/student/chat",
  "/student/fees",
  "/student/classes",
  "/student/practice/math12",
  "/student/battleground",
];

test("capture the second half", async ({ page }) => {
  test.setTimeout(300_000);
  for (const path of PATHS) {
    await page.goto(path);
    await page.waitForTimeout(9000);
    const name = path.replace(/\//g, "_");
    await page.screenshot({ path: `test-results/half2${name}.png`, fullPage: false });
    console.log(`${path} -> ${page.url()}`);
  }
});
