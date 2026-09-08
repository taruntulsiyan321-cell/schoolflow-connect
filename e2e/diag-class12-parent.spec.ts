import { test, expect } from "@playwright/test";

/** How slow is the Class 12 parent account, page by page? */
const EMAIL = "sharma.parent@wisdomcampus.com";
const PASSWORD = "DemoPass123!";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240000);

test("class 12 parent timings", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill(EMAIL);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/parent/, { timeout: 60000 });
  console.log(`\n  sign-in: ${Math.round((Date.now() - t0) / 1000)}s`);

  for (const path of ["/parent", "/parent/children", "/parent/marks", "/parent/insights"]) {
    const s = Date.now();
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const ready = await page
      .waitForFunction(
        () => {
          const t = document.body?.innerText ?? "";
          if (!t.trim() || /Restoring your session/i.test(t)) return false;
          const main = document.querySelector("main") ?? document.body;
          const mt = (main as HTMLElement).innerText ?? "";
          return mt.trim().length > 60 && !/\bLoading [a-z ]+…/i.test(mt);
        },
        { timeout: 40000 },
      )
      .then(() => true)
      .catch(() => false);
    const secs = Math.round((Date.now() - s) / 1000);
    const body = (await page.locator("body").innerText()).replace(/\s*\n+\s*/g, " ⏎ ");
    console.log(`  ${path.padEnd(20)} ${ready ? "ready" : "NOT READY"} in ${secs}s`);
    if (!ready) console.log(`      still: ${body.slice(0, 220)}`);
    await page.screenshot({ path: `test-results/class12/parent${path.replace(/\//g, "_")}.png`, fullPage: true });
  }
  console.log("");
});
