import { test as setup, expect } from "@playwright/test";

/**
 * Captures a real, already-authenticated session ONCE and saves it to disk.
 * Every other test in the "chromium" project reuses this file via
 * playwright.config.ts's storageState -- none of them ever submit a login
 * form themselves.
 *
 * Credentials default to the demo student fixture this repo's own seed
 * tooling already documents in plaintext (scripts/apply-seed.mjs) --
 * arjun.mehta@wisdomcampus.com. Override with E2E_STUDENT_EMAIL /
 * E2E_STUDENT_PASSWORD to run against a different account.
 */
const EMAIL = process.env.E2E_STUDENT_EMAIL || "arjun.mehta@wisdomcampus.com";
const PASSWORD = process.env.E2E_STUDENT_PASSWORD || "DemoPass123!";

const authFile = "e2e/.auth/student.json";

setup("authenticate as demo student", async ({ page }) => {
  // "/" is the marketing landing page, not the login form -- it links to
  // /auth via a "Launch Demo" button. Go straight there.
  await page.goto("/auth");

  await page.getByLabel("Email address").fill(EMAIL);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Confirm we actually landed in the student portal, not still on /auth
  // with a visible error -- fail loudly here rather than silently saving an
  // unauthenticated/garbage session that every later test would then trust.
  await expect(page).toHaveURL(/\/student/, { timeout: 20000 });

  await page.context().storageState({ path: authFile });
});
