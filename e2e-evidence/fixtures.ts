import { test as base, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { ROLES } from './roles'

export interface Signals {
  consoleErrors: string[]
  pageErrors: string[]
  /** status >= 400 responses, tagged supabase vs other. */
  badResponses: { status: number; url: string; supabase: boolean }[]
}

export const test = base.extend<{ signals: Signals }>({
  // Param is Playwright's fixture-provide callback (positional). Named `provide`
  // rather than `use` so eslint's react-hooks rule does not misread `use(...)`
  // as a React hook call in a non-component function.
  signals: async ({ page }, provide) => {
    const signals: Signals = { consoleErrors: [], pageErrors: [], badResponses: [] }
    page.on('console', (m) => {
      if (m.type() === 'error') signals.consoleErrors.push(m.text().slice(0, 300))
    })
    page.on('pageerror', (e) => signals.pageErrors.push(e.message.slice(0, 300)))
    page.on('response', (r) => {
      const s = r.status()
      if (s >= 400) {
        const url = r.url()
        signals.badResponses.push({ status: s, url: url.slice(0, 200), supabase: /supabase\.co/.test(url) })
      }
    })
    await provide(signals)
  },
})

export { expect }

/** True when a role's session was captured; otherwise the surface tests skip. */
export function roleAuthed(role: string): boolean {
  try {
    if (!existsSync('e2e-evidence/.auth/status.json')) return false
    const status = JSON.parse(readFileSync('e2e-evidence/.auth/status.json', 'utf8'))
    return !!status[role]?.authed
  } catch {
    return false
  }
}

/**
 * Navigate to a surface and record what a USER would see: rendered-data vs
 * rendered-empty vs error. Captures console errors, page errors, and any 4xx/5xx
 * (especially supabase). Screenshots every surface. Soft-asserts the health
 * criteria so one bad surface never aborts the run — the reporter shows per
 * surface pass/fail and the annotations carry the evidence. NO diagnosis here.
 */
export async function recordSurface(
  page: Page,
  signals: Signals,
  testInfo: TestInfo,
  name: string,
  url: string,
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // The app loads data client-side via Supabase; give it room to settle.
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)

  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')) || ''
  const errorBannerVisible =
    /could\s?n.?t load|failed to load|something went wrong|unexpected error|failed to fetch/i.test(bodyText)
  const looksEmpty =
    /(no\s+\w+\s+(yet|recorded|found|scheduled|to show)|nothing (to|needs)|empty|not set|no data|—)/i.test(bodyText)

  const supa4xx = signals.badResponses.filter((r) => r.supabase && r.status >= 400 && r.status < 500)
  const supa5xx = signals.badResponses.filter((r) => r.supabase && r.status >= 500)

  let outcome: 'error' | 'rendered-empty' | 'rendered-data' | 'blank'
  if (errorBannerVisible || signals.pageErrors.length > 0 || supa5xx.length > 0) outcome = 'error'
  else if (bodyText.trim().length < 40) outcome = 'blank'
  else if (looksEmpty) outcome = 'rendered-empty'
  else outcome = 'rendered-data'

  // Screenshot every surface (report evidence), not only on failure.
  const shot = testInfo.outputPath(`${name.replace(/[^a-z0-9]+/gi, '_')}.png`)
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
  await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' }).catch(() => {})

  const evidence = {
    surface: name,
    url,
    landedUrl: page.url(),
    outcome,
    errorBannerVisible,
    consoleErrors: signals.consoleErrors.slice(0, 8),
    pageErrors: signals.pageErrors.slice(0, 8),
    supabase4xx: supa4xx.slice(0, 10),
    supabase5xx: supa5xx.slice(0, 10),
    bodyTextSample: bodyText.replace(/\s+/g, ' ').slice(0, 240),
  }
  testInfo.annotations.push({ type: 'evidence', description: JSON.stringify(evidence) })

  // Health criteria — soft so the run continues and the table is complete.
  expect.soft(signals.pageErrors, `${name}: uncaught page errors`).toEqual([])
  expect.soft(supa5xx, `${name}: supabase 5xx`).toEqual([])
  expect.soft(supa4xx, `${name}: supabase 4xx (broken query/RPC)`).toEqual([])
  expect.soft(errorBannerVisible, `${name}: visible error banner`).toBe(false)
}

/**
 * A browser context with a session of its OWN, signed in through the real
 * /auth form rather than loaded from `.auth/<role>.json`.
 *
 * ── WHY, AND WHAT IT COSTS ───────────────────────────────────────────────
 *
 * Loading `storageState: authFile(role)` into a SECOND context kills the
 * session: Supabase rotates refresh tokens and detects reuse, so the second
 * context's refresh reads as a replay. Measured — one extra student context
 * turned 13 student surfaces red across tier1 and tier2 while the same specs
 * passed alone.
 *
 * Signing in separately avoids that, but it is NOT free: after this spec ran
 * mid-suite, the shared sessions for exactly the roles it signs in came back
 * `403` from `/auth/v1/user` and their refresh tokens `400`. Parent — the one
 * role it never touches — stayed `200`. Writing the fresh session back to the
 * file did not help; the sessions were already dead by the time the tier specs
 * loaded them.
 *
 * The mechanism was not worth pinning down further, because the ordering fix
 * removes the interaction entirely: **the spec that uses this runs LAST**
 * (`zz-known-issues.spec.ts`, see playwright.evidence.config.ts). Anything it
 * does to a session can no longer reach a spec that has not run yet.
 *
 * So: use this ONLY from a spec that runs after every file-backed one. A new
 * caller earlier in the alphabet reintroduces the whole failure.
 */
export async function freshSession(browser: Browser, role: string): Promise<Page> {
  const account = ROLES.find((r) => r.role === role)
  if (!account) throw new Error(`freshSession: no account for role ${role}`)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/auth')
  await page.getByLabel('Email or Mobile').fill(account.email)
  await page.locator('#signin-password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 30000 })
  return page
}

/**
 * Close a context minted by `freshSession`, SIGNING OUT first.
 *
 * WHY THIS IS NOT OPTIONAL. A Supabase sign-in creates a row in
 * `auth.sessions` and closing the browser does not remove it. Measured
 * 2026-09-07 after a day of suite runs: **166 live sessions for one teacher
 * account**, 146 for the admin, 142 for the parent. GoTrue slows down under
 * that, and the symptom is not an error — the app sits on "Restoring your
 * session…" and Playwright times out. It took tier1-writes from ~2 minutes to
 * 2 HOURS in one run, on tests that had nothing to do with what had changed.
 *
 * Sign-out is best-effort: failing to tidy up must not fail a test that has
 * already proved its point. `scope=global` is deliberate — it retires the
 * session server-side, which is the whole purpose; `local` would only clear
 * the browser and leave the row behind.
 */
export async function closeSession(page: Page): Promise<void> {
  try {
    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && /^sb-.*-auth-token$/.test(k)) {
          try {
            const v = JSON.parse(localStorage.getItem(k) || '{}')
            if (v && v.access_token) return v.access_token as string
          } catch { /* keep looking */ }
        }
      }
      return null
    })
    if (token) {
      const url = envValue('VITE_SUPABASE_URL')
      const anon = envValue('VITE_SUPABASE_PUBLISHABLE_KEY')
      await page.request.post(url + '/auth/v1/logout?scope=global', {
        headers: { apikey: anon, Authorization: 'Bearer ' + token },
      })
    }
  } catch { /* best effort — never fail a test on cleanup */ }
  await page.context().close()
}

/** Read one value out of the committed .env (no regex: keeps escapes out of it). */
function envValue(key: string): string {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith(key + '=')) continue
    let v = t.slice(key.length + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    return v
  }
  throw new Error('missing ' + key + ' in .env')
}
