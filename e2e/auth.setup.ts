import { test as setup, expect } from "@playwright/test";

/**
 * Captures a real, already-authenticated session ONCE and saves it to disk.
 * Every other test in the "chromium" project reuses this file via
 * playwright.config.ts's storageState -- none of them ever submit a login
 * form themselves.
 *
 * Defaults to the dedicated QA automation account (see
 * docs/DEMO_ACCOUNTS.md, applied via
 * supabase/migrations/20260805030000_qa_automation_student_account.sql) --
 * NOT arjun.mehta@wisdomcampus.com. That account accumulated hundreds of
 * practice sessions/bookmarks/mistakes/history entries from this repo's own
 * E2E runs, which made every later verification run slower and harder to
 * reason about. Override with E2E_STUDENT_EMAIL / E2E_STUDENT_PASSWORD to
 * run against a different account, but don't point this back at
 * arjun.mehta for routine verification.
 */
const EMAIL = process.env.E2E_STUDENT_EMAIL || "qa.automation@wisdomcampus.com";
const PASSWORD = process.env.E2E_STUDENT_PASSWORD || "QaAutomation123!";

const authFile = "e2e/.auth/student.json";

setup("authenticate as demo student", async ({ page }) => {
  // "/" is the marketing landing page, not the login form -- it links to
  // /auth via a "Launch Demo" button. Go straight there.
  await page.goto("/auth");

  await page.getByLabel("Email or Mobile").fill(EMAIL);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Confirm we actually landed in the student portal, not still on /auth
  // with a visible error -- fail loudly here rather than silently saving an
  // unauthenticated/garbage session that every later test would then trust.
  await expect(page).toHaveURL(/\/student/, { timeout: 20000 });

  await page.context().storageState({ path: authFile });
});
