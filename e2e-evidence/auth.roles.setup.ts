import { test as setup, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { ROLES, authFile } from './roles'

/**
 * Mints one authenticated session per reachable role by driving the real
 * /auth email+password form, and saves each to e2e-evidence/.auth/<role>.json.
 * Records reachability to e2e-evidence/.auth/status.json so the surface specs
 * can skip roles with no session rather than fail noisily.
 *
 * PRODUCTION-BUILD SAFETY: this file lives under e2e-evidence/ and is Playwright
 * test code. It is never imported by src/ and never enters the Vite app bundle,
 * so it cannot be reached from a production build. It only uses the public
 * /auth form + seeded demo credentials; it changes no auth configuration.
 */
const status: Record<string, { reachable: boolean; authed: boolean; note: string }> = {}

setup.beforeAll(() => {
  mkdirSync('e2e-evidence/.auth', { recursive: true })
  // Ensure a file exists for every role so specs' storageState never throws.
  for (const r of ROLES) {
    if (!existsSync(authFile(r.role))) {
      writeFileSync(authFile(r.role), JSON.stringify({ cookies: [], origins: [] }))
    }
  }
})

for (const account of ROLES) {
  setup(`auth ${account.role}`, async ({ page }) => {
    if (!account.reachable) {
      status[account.role] = { reachable: false, authed: false, note: 'no credentials (not in demo seed; supply via env)' }
      writeFileSync('e2e-evidence/.auth/status.json', JSON.stringify(status, null, 2))
      setup.skip(true, `${account.role}: no known credentials`)
      return
    }
    await page.goto('/auth')
    await page.getByLabel('Email or Mobile').fill(account.email)
    await page.locator('#signin-password').fill(account.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(account.home, { timeout: 25000 })
    await page.context().storageState({ path: authFile(account.role) })
    status[account.role] = { reachable: true, authed: true, note: `landed ${account.home}` }
    writeFileSync('e2e-evidence/.auth/status.json', JSON.stringify(status, null, 2))
  })
}
