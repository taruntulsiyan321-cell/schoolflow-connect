import { test, expect, roleAuthed, type Signals } from './fixtures'
import { authFile } from './roles'
import type { Page, TestInfo } from '@playwright/test'

/**
 * The panels a URL probe never loaded, and the two student routes nothing ever
 * opened.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * KNOWN_ISSUES 23. `tier1.spec.ts` navigates to `/teacher/homework` and
 * `/teacher/exams` and records what renders. Both routes are
 * `RedirectTeacherClassTab` — they write a sessionStorage hint and
 * `<Navigate to="/teacher/classes">`. What renders is the CLASS LIST. Those
 * surfaces were recorded green — rendered-empty, no 4xx, no console error —
 * for the whole life of that spec, while the panels they name were never
 * mounted and exam creation inside one of them was refused 42501 every time.
 *
 * The same hole is open on the student side: `/student/test/:id/attempt` and
 * `/student/test/:id/result` take an id, so no route-list probe can reach
 * them, and none does. `/student/tests` — the list — is all that was ever
 * loaded.
 *
 * So this file does not navigate to URLs and look at them. It CLICKS THE TAB
 * and asserts the panel's own controls are on screen, then drives the write
 * path those panels exist for. A tab that silently renders the class list
 * fails here, which is the whole point.
 *
 * ── FAIL, DO NOT SKIP ────────────────────────────────────────────────────
 *
 * When the teacher cannot create a test, the student half has nothing to
 * attempt. That is recorded as a FAILURE with the measured reason, never as a
 * skip: a skipped route reads as "not covered", and this route was already
 * "not covered" for months. Only a genuinely absent SESSION skips.
 *
 * Ordering: `tier1-panels` sorts before `tier1-reads`, `tier1-writes` and
 * `tier1.spec`, and long before `zz-known-issues` — it uses the file-backed
 * sessions and mints none of its own, so it cannot disturb what runs after it
 * (see fixtures.ts `freshSession` for what happens when a spec does).
 */

/** Anything that proves the class LIST is showing instead of a panel. */
const CLASS_LIST_MARKER = /Select Class/i

async function evidence(testInfo: TestInfo, name: string, page: Page, extra: Record<string, unknown>) {
  const shot = testInfo.outputPath(`${name.replace(/[^a-z0-9]+/gi, '_')}.png`)
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
  await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' }).catch(() => {})
  testInfo.annotations.push({ type: 'evidence', description: JSON.stringify({ surface: name, ...extra }) })
}

/** Supabase 4xx/5xx seen so far, which is what a refused write looks like. */
function supaErrors(signals: Signals) {
  return signals.badResponses.filter((r) => r.supabase)
}

async function openClassTab(page: Page, tab: RegExp): Promise<void> {
  await page.goto('/teacher/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  // The class selector renders once the teacher's classes load.
  const firstClass = page.locator('button', { hasText: /^\s*\d+/ }).first()
  await firstClass.waitFor({ state: 'visible', timeout: 30000 })
  await firstClass.click()
  await page.getByRole('button', { name: tab }).first().click()
  await page.waitForTimeout(2500)
}

test.describe('Tier1-P · teacher · the panels behind the redirects', () => {
  test.use({ storageState: authFile('teacher') })
  test.beforeEach(() => test.skip(!roleAuthed('teacher'), 'teacher session not available'))

  test('the Homework panel actually mounts, with its own controls', async ({ page, signals }, testInfo) => {
    await openClassTab(page, /^Homework$/)
    const body = await page.evaluate(() => document.body?.innerText ?? '')
    await evidence(testInfo, 'teacher homework panel', page, {
      bodySample: body.replace(/\s+/g, ' ').slice(0, 300),
      supabase: supaErrors(signals),
    })
    // A control that exists ONLY in the homework panel. `tier1.spec` could
    // never have seen this: it never left the class list.
    await expect(
      page.getByRole('button', { name: /assign|new homework|create/i }).first(),
      'the homework panel exposes its assign control',
    ).toBeVisible({ timeout: 20000 })
    expect(supaErrors(signals), 'homework panel: supabase errors').toEqual([])
  })

  test('the Tests panel actually mounts, with its own controls', async ({ page, signals }, testInfo) => {
    await openClassTab(page, /^Tests$/)
    const body = await page.evaluate(() => document.body?.innerText ?? '')
    await evidence(testInfo, 'teacher tests panel', page, {
      bodySample: body.replace(/\s+/g, ' ').slice(0, 300),
      supabase: supaErrors(signals),
    })
    await expect(
      page.getByRole('button', { name: /create test/i }).first(),
      'the tests panel exposes Create Test',
    ).toBeVisible({ timeout: 20000 })
    expect(supaErrors(signals), 'tests panel: supabase errors').toEqual([])
  })

  test('the Exams & Marks panel actually mounts, with its own controls', async ({ page, signals }, testInfo) => {
    await openClassTab(page, /^Exams & Marks$/)
    const body = await page.evaluate(() => document.body?.innerText ?? '')
    await evidence(testInfo, 'teacher exams panel', page, {
      bodySample: body.replace(/\s+/g, ' ').slice(0, 300),
      supabase: supaErrors(signals),
    })
    expect(body, 'the exams panel rendered, not the bare class list').not.toMatch(
      /^\s*Select Class\s*$/,
    )
    await expect(
      page.getByText(/exam/i).first(),
      'the exams panel names exams',
    ).toBeVisible({ timeout: 20000 })
    expect(supaErrors(signals), 'exams panel: supabase errors').toEqual([])
  })

  /**
   * The write path the panel exists for. This is the probe KNOWN_ISSUES 23
   * says was missing: `/teacher/exams` recorded green while the write beneath
   * it was refused every time.
   */
  test('a teacher creates and publishes a test through the Tests panel', async ({ page, signals }, testInfo) => {
    await openClassTab(page, /^Tests$/)
    await page.getByRole('button', { name: /create test/i }).first().click()

    const title = `E2E panel test ${Date.now()}`
    await page.getByPlaceholder('Title *').fill(title)
    await page.getByPlaceholder('Max marks').fill('5')
    await page.getByRole('button', { name: /publish now/i }).first().click()
    await page.getByRole('button', { name: /next: choose source/i }).click()

    await page.getByText(/write questions manually/i).click()
    await page.getByPlaceholder('Question text *').fill('What is 2 + 3?')
    await page.getByPlaceholder('Marks').fill('5')
    await page.getByRole('button', { name: /add question/i }).click()
    await page.getByRole('button', { name: /next: review/i }).click()

    await page.getByRole('button', { name: /^Publish$/ }).click()
    await page.waitForTimeout(6000)

    const body = await page.evaluate(() => document.body?.innerText ?? '')
    const supa = supaErrors(signals)
    const testsWrites = supa.filter((r) => /\/rest\/v1\/tests/.test(r.url))
    await evidence(testInfo, 'teacher creates a test', page, {
      title,
      bodySample: body.replace(/\s+/g, ' ').slice(0, 400),
      supabase: supa,
      testsTableWrites: testsWrites,
    })

    expect(testsWrites, 'POST /rest/v1/tests was not refused').toEqual([])
    expect(body, 'the builder reported a failure').not.toMatch(/failed to create test/i)
    await expect(
      page.getByText(/test published successfully/i),
      'the panel confirms the test was published',
    ).toBeVisible({ timeout: 20000 })
  })
})

test.describe('Tier1-P · student · the attempt and result routes', () => {
  test.use({ storageState: authFile('student') })
  test.beforeEach(() => test.skip(!roleAuthed('student'), 'student session not available'))

  test('a student opens a class test, answers it, submits, and reads the result', async ({ page, signals }, testInfo) => {
    await page.goto('/student/tests', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)

    const listBody = await page.evaluate(() => document.body?.innerText ?? '')
    const attemptLink = page.locator('a[href*="/attempt"]').first()
    const linkCount = await page.locator('a[href*="/attempt"]').count()

    await evidence(testInfo, 'student tests list', page, {
      attemptLinks: linkCount,
      bodySample: listBody.replace(/\s+/g, ' ').slice(0, 300),
      supabase: supaErrors(signals),
    })

    // No skip. If the list is empty the route is unproven, and "unproven"
    // is the defect this file was written to stop recording as green.
    expect(
      linkCount,
      'the student has at least one class test to attempt — an empty list leaves ' +
        '/student/test/:id/attempt unprovable, which is KNOWN_ISSUES 23 all over again',
    ).toBeGreaterThan(0)

    await attemptLink.click()
    await expect(page, 'the attempt route loaded').toHaveURL(/\/student\/test\/[0-9a-f-]+\/attempt/i, {
      timeout: 30000,
    })
    await page.waitForTimeout(3000)

    const attemptBody = await page.evaluate(() => document.body?.innerText ?? '')
    await evidence(testInfo, 'student test attempt', page, {
      url: page.url(),
      bodySample: attemptBody.replace(/\s+/g, ' ').slice(0, 400),
      supabase: supaErrors(signals),
    })
    expect(attemptBody, 'the attempt screen did not refuse to start').not.toMatch(
      /could not start test|test not found|no questions in this test/i,
    )
    expect(attemptBody, 'a question is on screen').toMatch(/Question\s+1\s+of\s+\d+/i)

    // Answer whatever the first question offers, then walk to the end.
    const firstChoice = page.locator('input[type="radio"], input[type="checkbox"]').first()
    if (await firstChoice.count()) {
      await firstChoice.check({ force: true }).catch(() => {})
    } else {
      const textAnswer = page.locator('textarea, input[type="text"], input[type="number"]').first()
      if (await textAnswer.count()) await textAnswer.fill('42')
    }
    await page.waitForTimeout(1500)

    for (let i = 0; i < 30; i++) {
      const next = page.getByRole('button', { name: /^Next$/ })
      if (!(await next.count()) || !(await next.first().isEnabled())) break
      await next.first().click()
      await page.waitForTimeout(400)
    }

    await page.getByRole('button', { name: /^Submit$/ }).click()
    await expect(page, 'submitting lands on the result route').toHaveURL(
      /\/student\/test\/[0-9a-f-]+\/result/i,
      { timeout: 30000 },
    )
    await page.waitForTimeout(3000)

    const resultBody = await page.evaluate(() => document.body?.innerText ?? '')
    const supa = supaErrors(signals)
    await evidence(testInfo, 'student test result', page, {
      url: page.url(),
      bodySample: resultBody.replace(/\s+/g, ' ').slice(0, 400),
      supabase: supa,
    })
    expect(supa, 'the attempt round trip raised no supabase error').toEqual([])
    expect(resultBody, 'the result screen shows a score').toMatch(/\d+\s*\/\s*\d+|score/i)
    expect(resultBody, 'the result screen is not an error state').not.toMatch(
      /could not|failed to|not found/i,
    )
  })
})
