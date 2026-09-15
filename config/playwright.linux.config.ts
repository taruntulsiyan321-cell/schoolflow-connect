/**
 * The same e2e suite, runnable on Linux.
 *
 * playwright.config.ts pins `channel: "msedge"` and `headless: false` — a
 * deliberate choice for the machine it was written on, where the downloaded
 * Playwright browsers would not launch. Neither Edge nor a display exists in a
 * container, so that config cannot run there at all, and the suite it guards
 * is gate-blocking.
 *
 * This changes ONLY how the browser is obtained. Same testDir, same
 * `workers: 1` serialization (every test shares one live account), same
 * `retries: 0` (a flake reported as "flaky" still exits 0, which is the
 * green-while-broken shape this suite already had to fix), same storageState.
 * Nothing about what is asserted differs, so a pass here is a pass there.
 *
 * executablePath rather than `npx playwright install`: the container ships a
 * Chromium build that the pinned @playwright/test does not know the revision
 * of, and downloading a second one to satisfy a version string tests nothing.
 *
 * ── KNOWN LIMIT, MEASURED ────────────────────────────────────────────────
 *
 * This config launches, loads the app, fills the login form and issues the
 * POST to /auth/v1/token — and in a sandbox whose egress goes through an
 * agent proxy that request never completes. The proxy's own status endpoint
 * reports the tunnel to the Supabase host closing mid-exchange
 * ("1838 B sent, 39 B received") for the BROWSER specifically; Node's fetch
 * to the same host through the same proxy works throughout this repo's
 * scripts. Disabling TLS verification would "fix" it and is not an option.
 *
 * So: usable on any machine or CI runner with ordinary outbound HTTPS. Inside
 * an egress-proxied sandbox the suite's result is UNKNOWN, not passing.
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8080";
import { fileURLToPath } from "node:url";
import path from "node:path";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
// Outbound HTTPS in this container goes through an agent proxy whose CA is
// already in the system trust store. Chromium still has to be TOLD to use it,
// or every Supabase call from the page fails silently and the login form just
// sits there. Nothing is disabled: the CA is trusted, the proxy is declared.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const proxy = PROXY ? { server: PROXY, bypass: "127.0.0.1,localhost" } : undefined;

export default defineConfig({
  testDir: `${ROOT}/e2e`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [["list"]],
  outputDir: `${ROOT}/test-results/run-linux-${process.env.PW_RUN_ID ?? "local"}`,
  use: { baseURL, trace: "off", screenshot: "only-on-failure" },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
        launchOptions: { executablePath: CHROMIUM },
        proxy,
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
        launchOptions: { executablePath: CHROMIUM },
        proxy,
        storageState: `${ROOT}/e2e/.auth/student.json`,
      },
    },
  ],
});
