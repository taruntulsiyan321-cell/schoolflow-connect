import { defineConfig, devices } from '@playwright/test'

/**
 * Evidence harness config — SEPARATE from playwright.config.ts so it does not
 * disturb the existing suite. Uses Playwright's bundled Chromium headless (the
 * committed config pins msedge/headed for the author's machine, which does not
 * exist in CI/cloud). Test dir is e2e-evidence/ so the two suites never glob
 * each other's files.
 *
 * Run: npm run test:e2e:evidence   (dev server must be up on :8080)
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
      testMatch: /tier\d(-writes|-reads)?\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
