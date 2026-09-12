import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Walks to each of the three additions the way a principal would reach them,
 * and captures what lands. The panel has no URLs — navigation is an internal
 * history stack — so every step has to be a real click.
 */
test("the three principal additions", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/auth");
  await page.getByLabel("Email or Mobile").fill("principal@wisdomcampus.com");
  await page.locator("#signin-password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/principal/, { timeout: 30000 });
  await page.waitForTimeout(4000);

  // ── 1. Attendance ranking: Dashboard → Attendance → a class → Cumulative ──
  await page.getByRole("button", { name: "Attendance", exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /10 — A/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /cumulative/i }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/pp-attendance-ranking.png" });
  const rankHeader = await page.locator("text=/^#$/").count();
  console.log("attendance ranking: rank column present =", rankHeader > 0);

  // ── 2. Tests tab: Classes → 10 — A → Tests → a test ──
  await page.getByRole("button", { name: "Classes", exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /10 — A/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "tests", exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/pp-tests-tab.png" });
  const testCards = await page.getByText("View marks →").count();
  console.log("tests tab: test cards =", testCards);

  await page.getByText("View marks →").first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/pp-test-detail.png" });
  console.log("test detail heading =", await page.locator("h1").first().textContent());

  // ── 3. Exam leaderboard: back to class → Exams → an exam ──
  await page.getByRole("button", { name: "Classes", exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /10 — A/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "exams", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByText("View results →").first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/pp-exam-leaderboard.png", fullPage: true });
  const leaderboard = await page.getByText("Leaderboard").count();
  console.log("exam leaderboard present =", leaderboard > 0);

  expect(rankHeader, "attendance ranking column").toBeGreaterThan(0);
  expect(testCards, "tests listed on the class").toBeGreaterThan(0);
  expect(leaderboard, "exam leaderboard").toBeGreaterThan(0);
});
