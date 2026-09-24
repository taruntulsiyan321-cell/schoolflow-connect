import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'
import { expect } from './fixtures'

/**
 * Riverside Public School — the E2E organisation (20260925200000, made whole by 20260925210000) — and its
 * people, signed in through the real /auth form. The zz-riverside-* specs share this one home for how a
 * Riverside person signs in and how a teacher reaches a class, so the two cannot drift.
 *
 * Every login's password is the published E2E one. The shared `.auth` sessions belong to Wisdom Campus and
 * are never touched here.
 */
export const RIVERSIDE_PASSWORD = 'E2eSchool123!'

export interface Person {
  ctx: BrowserContext
  page: Page
  /** Uncaught page errors seen on any screen this person opened. */
  errors: string[]
}

export async function settle(page: Page, ms = 1500) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

export async function signIn(browser: Browser, email: string, home: RegExp): Promise<Person> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
  await page.goto('/auth', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email or Mobile').fill(email)
  await page.locator('#signin-password').fill(RIVERSIDE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page, `${email} signs in and lands on their panel`).toHaveURL(home, { timeout: 45000 })
  return { ctx, page, errors }
}

export async function closeAll(...people: (Person | undefined)[]) {
  for (const person of people) await person?.ctx.close().catch(() => {})
}

/** The bordered table carrying every one of these headers. */
export function table(page: Page, ...headers: string[]): Locator {
  let t = page.locator('div.border.bg-card')
  for (const h of headers) t = t.filter({ hasText: h })
  return t.last()
}

/** A teacher's class screen: the section's chip on /teacher/classes (e.g. "8 A"), then one of its tabs. */
export async function openClassTab(page: Page, section: string, tab: string) {
  await page.goto('/teacher/classes', { waitUntil: 'domcontentloaded' })
  await settle(page)
  await page.getByRole('button', { name: new RegExp(`\\b${section} · `) }).first().click()
  await page.getByRole('button', { name: tab, exact: true }).click()
}

/**
 * Open `url` until `target` is on it, reloading every 10 s: what a notification queue delivers arrives
 * within a minute, not on the first paint. Fails with `what` if it never does.
 */
export async function eventually(page: Page, url: string, target: () => Locator, what: string, ms = 150000) {
  const deadline = Date.now() + ms
  for (;;) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await settle(page, 2500)
    if ((await target().count()) > 0) return
    if (Date.now() > deadline) break
    await page.waitForTimeout(10000)
  }
  await expect(target(), what).not.toHaveCount(0)
}
