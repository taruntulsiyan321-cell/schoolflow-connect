import { test, expect, roleAuthed, type Signals } from './fixtures'
import { authFile } from './roles'
import type { Page, TestInfo } from '@playwright/test'

/**
 * Tier 5 — INTERACTIONS, not just loads. Each performs the primary action and
 * records the edge-function/RPC responses it triggers (ai-gateway is undeployed
 * with an unreconciled fix and has recorded nothing since 2026-08-25, so several
 * are expected to fail). Recorded SEPARATELY — a shared root cause is the
 * reviewer's conclusion, not an observation here. Resilient: a missing control
 * is recorded, not thrown, so the run completes.
 */

async function recordInteraction(
  page: Page,
  signals: Signals,
  testInfo: TestInfo,
  name: string,
  action: () => Promise<string>,
): Promise<void> {
  let actionNote = ''
  try {
    actionNote = await action()
  } catch (e) {
    actionNote = `action error: ${(e as Error).message.slice(0, 160)}`
  }
  await page.waitForTimeout(3500) // let network settle after the action
  const shot = testInfo.outputPath(`${name.replace(/[^a-z0-9]+/gi, '_')}.png`)
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
  await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' }).catch(() => {})
  const fnCalls = signals.badResponses.filter((r) => /\/functions\/v1\//.test(r.url))
  const evidence = {
    surface: name,
    action: actionNote,
    landedUrl: page.url(),
    edgeFunction4xx5xx: fnCalls,
    otherSupabase4xx5xx: signals.badResponses.filter((r) => r.supabase && !/\/functions\/v1\//.test(r.url)).slice(0, 8),
    pageErrors: signals.pageErrors.slice(0, 5),
    consoleErrors: signals.consoleErrors.slice(0, 6),
  }
  testInfo.annotations.push({ type: 'interaction', description: JSON.stringify(evidence) })
  // Health: no server error / edge-function failure / uncaught error.
  expect.soft(signals.pageErrors, `${name}: uncaught page errors`).toEqual([])
  expect.soft(fnCalls, `${name}: edge-function 4xx/5xx`).toEqual([])
  expect.soft(signals.badResponses.filter((r) => r.supabase && r.status >= 500), `${name}: supabase 5xx`).toEqual([])
}

test.describe('Tier5 · student interactions', () => {
  test.use({ storageState: authFile('student') })
  test.beforeEach(() => test.skip(!roleAuthed('student'), 'student session not available'))

  test('T5 student · AI coach send a message', async ({ page, signals }, testInfo) => {
    await page.goto('/student/aicoach', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await recordInteraction(page, signals, testInfo, 'T5 student · AI coach send message', async () => {
      const box = page.getByRole('textbox').first()
      await box.waitFor({ state: 'visible', timeout: 15000 })
      await box.fill('What is my attendance percentage?')
      const send = page.getByRole('button', { name: /send|ask/i }).first()
      if (await send.isVisible().catch(() => false)) await send.click()
      else await box.press('Enter')
      return 'typed a question and submitted to the coach'
    })
  })

  test('T5 student · Practice start a set', async ({ page, signals }, testInfo) => {
    await page.goto('/student/practice', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await recordInteraction(page, signals, testInfo, 'T5 student · Practice start', async () => {
      // Instant modes need no config: try Weak Areas / Incorrect / first mode card.
      for (const label of [/weak areas/i, /incorrect/i, /bookmarked/i, /subject practice/i]) {
        const el = page.getByText(label).first()
        if (await el.isVisible().catch(() => false)) {
          await el.click()
          return `clicked practice mode ${label}`
        }
      }
      return 'no recognizable practice mode control found'
    })
  })

  test('T5 student · Recovery begin a session', async ({ page, signals }, testInfo) => {
    await page.goto('/student/recovery', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await recordInteraction(page, signals, testInfo, 'T5 student · Recovery begin', async () => {
      const cta = page.getByRole('button', { name: /start recovery|start|begin/i }).first()
      if (await cta.isVisible().catch(() => false)) { await cta.click(); return 'clicked start recovery' }
      return 'no start-recovery control visible (may be empty queue — an outcome)'
    })
  })

  test('T5 student · Revision begin', async ({ page, signals }, testInfo) => {
    await page.goto('/student/revision', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await recordInteraction(page, signals, testInfo, 'T5 student · Revision begin', async () => {
      const cta = page.getByRole('button', { name: /quick revision|start|practice topic/i }).first()
      if (await cta.isVisible().catch(() => false)) { await cta.click(); return 'clicked quick revision' }
      return 'no revision start control visible (may be empty queue — an outcome)'
    })
  })

  test('T5 student · Doubts post a doubt', async ({ page, signals }, testInfo) => {
    await page.goto('/student/doubts', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await recordInteraction(page, signals, testInfo, 'T5 student · Doubts post', async () => {
      const ask = page.getByRole('button', { name: /ask|new doubt|post/i }).first()
      if (!(await ask.isVisible().catch(() => false))) return 'no Ask control visible'
      await ask.click()
      await page.waitForTimeout(1000)
      const body = page.getByRole('textbox').last()
      if (await body.isVisible().catch(() => false)) await body.fill('Evidence-harness test doubt: how do I solve linear equations?')
      const submit = page.getByRole('button', { name: /post|submit|send|ask/i }).last()
      if (await submit.isVisible().catch(() => false)) { await submit.click(); return 'filled and submitted a doubt' }
      return 'ask form opened but no submit control found'
    })
  })
})
