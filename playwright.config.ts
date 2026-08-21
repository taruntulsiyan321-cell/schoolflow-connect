import { defineConfig, devices } from "@playwright/test";

/**
 * Points at the local dev server by default. Set PLAYWRIGHT_BASE_URL to
 * target a deployed environment instead -- some bugs only reproduce against
 * real Supabase project state, not a fresh local build, so pointing this at
 * a live deployment is sometimes necessary.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Every test in this suite shares one live demo account (same
  // storageState) -- fullyParallel:false only serializes tests within a
  // single file. Without pinning workers to 1, Playwright still runs
  // separate files concurrently, and two tests finishing sessions or
  // reading history at the same moment corrupt each other's "before/after"
  // counts. Correctness requires full serialization here, not just speed.
  workers: 1,
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
