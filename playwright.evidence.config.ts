import { defineConfig, devices } from '@playwright/test'

/**
 * Evidence harness config — SEPARATE from playwright.config.ts so it does not
 * disturb the existing suite. Uses Playwright's bundled Chromium headless (the
 * committed config pins msedge/headed for the author's machine, which does not
 * exist in CI/cloud). Test dir is e2e-evidence/ so the two suites never glob
 * each other's files.
 *
 * Run: npm run test:e2e:evidence   (dev server must be up on :8080)
 *
 * `known-issues.spec.ts` is matched alongside the tier files: it verifies
 * specific KNOWN_ISSUES fixes end to end rather than a role's surfaces.
 *
 * `aa-reachability.spec.ts` is named to sort FIRST. It asserts that Supabase
 * answers at all, so a network outage reads as one red line at the top instead
 * of a hundred plausible-looking product regressions underneath it.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080'

export default defineConfig({
  testDir: './e2e-evidence',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/evidence.json' }],
  ],
  outputDir: 'test-results/evidence-artifacts',
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 45000,
    actionTimeout: 20000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.roles\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'evidence',
      // FILE ORDER IS LOAD-BEARING — Playwright runs spec files alphabetically,
      // and two names exploit that deliberately:
      //
      //   aa-reachability  FIRST. Answers "is the app broken, or is the network
      //                    down?" before hours go into the wrong cause.
      //   zz-known-issues  LAST. It signs roles in through the real /auth form
      //                    to get sessions of their own, and doing that mid-run
      //                    left the shared `.auth/<role>.json` sessions DEAD:
      //                    32 of 68 tests failed, and the four failing roles
      //                    were exactly the four it signs in. Parent, which it
      //                    never touches, passed every time; tier1-reads passed
      //                    12/12 when run without it. Last means nothing it does
      //                    to a session can reach a spec that has not run yet.
      testMatch: /(aa-reachability|tier\d(-writes|-reads|-panels)?|zz-known-issues)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
