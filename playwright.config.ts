import { defineConfig, devices } from "@playwright/test";

/**
 * Points at the live deployed app by default (real Supabase project, real
 * data) rather than a local dev server -- the Practice module bugs found so
 * far only reproduced against the actual database state, not a local build.
 * Override with PLAYWRIGHT_BASE_URL to point at a different environment.
 */
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || "https://academybloom-digital.lovable.app";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  // Default 30s is too tight for this live, network-dependent app --
  // session-restore/cold-load has been observed taking up to ~28s on its own.
  timeout: 60000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        // Use the machine's real, already-installed Edge instead of
        // Playwright's own downloaded binary. Both the full and headless
        // Playwright-managed builds failed to launch here right after
        // being confirmed present on disk -- consistent with antivirus
        // quarantining a freshly-downloaded, unsigned-looking automation
        // browser. A real, already-trusted browser install won't hit that.
        channel: "msedge",
        headless: false,
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "msedge",
        // Reuses the session already captured by `npm run test:e2e:auth` --
        // no test in this project ever submits a password itself. No
        // `dependencies` link on purpose: re-running this project must
        // never re-trigger the login step automatically. Run
        // test:e2e:auth again by hand (only when the saved session
        // actually expires) rather than making every test run silently
        // re-authenticate.
        storageState: "e2e/.auth/student.json",
      },
    },
  ],
});
