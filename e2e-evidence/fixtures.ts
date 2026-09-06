import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'

export interface Signals {
  consoleErrors: string[]
  pageErrors: string[]
  /** status >= 400 responses, tagged supabase vs other. */
  badResponses: { status: number; url: string; supabase: boolean }[]
}

export const test = base.extend<{ signals: Signals }>({
  signals: async ({ page }, use) => {
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
    await use(signals)
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
