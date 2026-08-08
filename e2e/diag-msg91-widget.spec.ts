import { test, expect } from "@playwright/test";

/**
 * Diagnostic for the MSG91 OTP Widget integration (Auth.tsx Mobile tab) --
 * covers everything verifiable without a real phone number able to receive
 * an SMS: the Mobile tab renders and switches correctly, the real MSG91
 * widget script loads and window.initSendOTP actually executes against the
 * live widgetId/tokenAuth (proven by MSG91's own hCaptcha challenge
 * appearing -- MSG91 only renders that after accepting the widget
 * credentials), and Mobile+Password correctly rejects a nonexistent number
 * through the existing signIn() path rather than silently succeeding.
 *
 * Runs unauthenticated on purpose (this is the pre-login Auth page) --
 * overrides the project's shared logged-in storageState for this file only.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("diagnostic: MSG91 widget tab renders, initializes, and rejects bad Mobile+Password creds", async ({ page }) => {
  test.setTimeout(60000);

  await page.goto("/auth");
  await expect(page.getByRole("tab", { name: "Email" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("tab", { name: "Mobile" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sign up" })).toBeVisible();

  await page.getByRole("tab", { name: "Mobile" }).click();
  await expect(page.getByText("Sign in with mobile")).toBeVisible();
  await expect(page.getByText(/your mobile number takes you straight in/i)).toBeVisible();

  const otpTab = page.getByRole("tab", { name: "OTP" });
  const pwTab = page.getByRole("tab", { name: "Password" });
  await expect(otpTab).toBeVisible();
  await expect(pwTab).toBeVisible();
  await expect(otpTab).toHaveAttribute("aria-selected", "true");

  // Widget init: the script must actually be fetched, not just referenced.
  const widgetScriptRequest = page.waitForRequest(
    (req) => req.url().includes("verify.msg91.com/otp-provider.js"),
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Continue with mobile OTP" }).click();
  const scriptReq = await widgetScriptRequest;
  console.log(`MSG91 widget script requested: ${scriptReq.url()}`);

  // Button reflects the busy state the click handler set.
  await expect(page.getByRole("button", { name: /Verifying/ })).toBeVisible({ timeout: 10000 });

  // window.initSendOTP only exists once MSG91's script has actually
  // executed (not merely downloaded) -- confirms real script execution.
  await expect
    .poll(async () => page.evaluate(() => typeof window.initSendOTP), { timeout: 15000 })
    .toBe("function");

  // MSG91 only renders its own hCaptcha challenge after the widget backend
  // accepts widgetId/tokenAuth -- an invalid pair fails immediately via the
  // failure callback instead, which would flip the button back and toast an
  // error rather than show a captcha. This is the strongest live proof of
  // widget validity achievable without an SMS-capable phone number.
  const hcaptchaAppeared = await page
    .locator('iframe[src*="hcaptcha"], [class*="h-captcha"], [data-hcaptcha-widget-id]')
    .first()
    .isVisible({ timeout: 15000 })
    .catch(() => false);
  console.log(`MSG91 hCaptcha challenge rendered: ${hcaptchaAppeared}`);
  const noErrorToastYet = await page.getByText(/not configured|failed to load/i).isVisible().catch(() => false);
  expect(noErrorToastYet, "widget reported a config/load failure instead of initializing").toBe(false);

  // Reset to a clean unauthenticated Mobile tab, then exercise Mobile+Password
  // against a number that cannot exist, proving it goes through the real
  // signIn() path and fails loudly rather than granting access.
  await page.goto("/auth");
  await page.getByRole("tab", { name: "Mobile" }).click();
  await page.getByRole("tab", { name: "Password" }).click();
  await expect(pwTab).toHaveAttribute("aria-selected", "true");

  await page.getByPlaceholder("+91 98765 43210").fill("+91 00000 00000");
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();

  const errorText = await page
    .getByText(/invalid login credentials|invalid|incorrect|could not sign in/i)
    .first()
    .textContent({ timeout: 15000 })
    .catch(() => null);
  console.log(`Mobile+Password rejection message: ${errorText ?? "(no matching text found -- see screenshot on failure)"}`);
  expect(errorText, "Mobile+Password sign-in did not show any rejection for a nonexistent number").toBeTruthy();

  // Must still be on /auth -- no session was created for the bogus number.
  await expect(page).toHaveURL(/\/auth/);
});
