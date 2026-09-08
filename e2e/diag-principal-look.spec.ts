import { test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);
test("principal look", async ({ page }) => {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill("principal@wisdomcampus.com");
  await page.locator("#signin-password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/principal/, { timeout: 60000 });
  for (const p of ["/principal", "/principal/analytics", "/principal/attendance"]) {
    await page.goto(p, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `test-results/principal${p.replace(/\//g,"_")}.png`, fullPage: true });
    const t = (await page.locator("main").innerText().catch(()=>"")).replace(/\s*\n+\s*/g," | ");
    console.log(`\n### ${p}\n${t.slice(0,700)}\n`);
  }
});
