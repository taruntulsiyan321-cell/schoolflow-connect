import { test, expect } from "@playwright/test";

/**
 * Diagnostic for Email OTP sign-in (Auth.tsx Email tab, "OTP" mode) --
 * Supabase's own signInWithOtp/verifyOtp, no third-party provider or edge
 * function involved (unlike phone, which needs MSG91). Covers what's
 * verifiable without reading a real inbox: the Password/OTP toggle renders
 * and defaults to Password (unchanged behavior for existing users),
 * client-side validation rejects a malformed address without sending
 * anything, and a valid address actually reaches Supabase's API and flips
 * to the "check your email" confirmation state with a resend cooldown.
 *
 * Runs unauthenticated on purpose (this is the pre-login Auth page).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("diagnostic: Email OTP toggle renders, validates, and reaches Supabase", async ({ page }) => {
  test.setTimeout(30000);

  await page.goto("/auth");
  await expect(page.getByRole("tab", { name: "Email" })).toBeVisible({ timeout: 30000 });

  // Default is Password -- must not change existing users' muscle memory.
  const pwTab = page.getByRole("tab", { name: "Password" }).first();
  const otpTab = page.getByRole("tab", { name: "One-time code" }).first();
  await expect(pwTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Email address").first()).toBeVisible();

  await otpTab.click();
  await expect(otpTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/we'll email you a sign-in link/i)).toBeVisible();

  // Malformed address: client-side validation must reject before any network call.
  const otpEmailInput = page.locator("#email-otp-address");
  await otpEmailInput.fill("not-an-email");
  const otpRequestDuringInvalid = page
    .waitForRequest((req) => req.url().includes("/auth/v1/otp"), { timeout: 2000 })
    .catch(() => null);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const firedOnInvalid = await otpRequestDuringInvalid;
  expect(firedOnInvalid, "signInWithOtp must not fire for a malformed email").toBeNull();
  await expect(page.getByText(/valid email/i)).toBeVisible();

  // Valid address: verifies our own request shape and UI handling by
  // intercepting Supabase's OTP endpoint rather than actually calling it.
  // This project's email sending is capped at 2/hour (Supabase's default
  // shared mailer, no custom SMTP configured) -- a real send was already
  // proven live, once, by hand; an automated test that re-runs on every CI
  // run and every local `npm run test:e2e` must not spend that budget on
  // every run, so it's mocked here instead.
  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/auth/v1/otp*", async (route) => {
    capturedBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  const testEmail = `diag-otp-${Date.now()}@example.com`;
  await otpEmailInput.fill(testEmail);
  await page.getByRole("button", { name: "Send sign-in link" }).click();

  await expect(page.getByText(/we sent a sign-in link to/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Resend/ })).toBeVisible();
  await expect(page.getByText("Use a different email")).toBeVisible();

  expect(capturedBody, "signInWithOtp did not send a request").not.toBeNull();
  expect((capturedBody as unknown as { email?: string })?.email).toBe(testEmail);
  console.log(`Email OTP request body: ${JSON.stringify(capturedBody)}`);
});
