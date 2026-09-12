import { test } from "@playwright/test";

/**
 * Captures the LOADING frame of a screen, not the loaded one — the frame the
 * whole skeleton pass exists to improve, and the one a normal walk never sees
 * because it waits for the page to settle first.
 *
 * It waits for the skeleton to be on screen and shoots at that moment, so the
 * file is the thing being reviewed rather than a guess at when to click.
 *
 * Retarget SHOTS at whatever is being reviewed — this is a camera, not a gate.
 * `diag-loading-states.spec.ts` is the gate.
 */
const SHOTS = ["/student/notifications", "/student/revision", "/student/timetable"];

test("capture each screen's loading frame", async ({ page }) => {
  test.setTimeout(300_000);
  for (const path of SHOTS) {
    await page.goto(path, { waitUntil: "commit" });
    const name = path.replace(/\//g, "_") || "_root";
    try {
      await page.waitForSelector('[role="status"][aria-busy="true"]', { timeout: 8000 });
      await page.screenshot({ path: `test-results/skeleton${name}.png`, fullPage: false });
      console.log(`captured loading ${path}`);
    } catch {
      console.log(`NO SKELETON SEEN on ${path} (loaded before the watcher attached)`);
    }
    // And the settled frame — the skeleton is only right if the layout it drew
    // is the layout that arrives.
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `test-results/loaded${name}.png`, fullPage: false });
  }
});
