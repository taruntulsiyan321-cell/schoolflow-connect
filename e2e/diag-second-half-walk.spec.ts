import { test } from "@playwright/test";

/**
 * The OTHER half of the student panel.
 *
 * `src/gurukul/pages/` is the designed half — GlassCard, PageHeader, the
 * display face. `src/pages/student/` and `src/pages/shared/` are the screens a
 * student reaches from those same menus, built against plain shadcn Card. A
 * student crosses between them constantly, so the panel changes identity
 * mid-journey.
 *
 * Record-scoped routes need a real id; `args` are read from PANEL_TEST_ID so
 * this does not rot when the seed changes.
 */
const TEST_ID = process.env.PANEL_TEST_ID || "9ec48b96-284e-4ae3-970b-6f7efef49f73";

const PATHS = [
  "/student/chat",
  "/student/fees",
  "/student/classes",
  "/student/battleground",
  `/student/test/${TEST_ID}/attempt`,
  `/student/test/${TEST_ID}/result`,
];

test("capture the second half", async ({ page }) => {
  test.setTimeout(300_000);
  for (const path of PATHS) {
    await page.goto(path);
    await page.waitForTimeout(9000);
    const name = path.replace(/\//g, "_").replace(TEST_ID, "id");
    await page.screenshot({ path: `test-results/half2${name}.png`, fullPage: false });
    console.log(`${path} -> ${page.url()}`);
  }
});
