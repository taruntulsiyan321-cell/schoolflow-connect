import { test, expect } from './fixtures'
import { authFile } from './roles'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * KNOWN_ISSUES fixes, verified through the real app.
 *
 * Separate from the tier files on purpose: those record what a role can do on a
 * surface, this one pins a specific defect closed. Each describe block names the
 * issue it retires, and each carries BOTH controls — the refusal that proves the
 * rule is live, and the success that proves the fix reaches it. A denial with no
 * positive control is not evidence.
 *
 * Everything written here is deleted again, and the delete is asserted.
 */

/** Read one value out of the committed .env (no regex: keeps escapes out of it). */
function envVal(key: string): string {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith(key + '=')) continue
    let v = t.slice(key.length + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    return v
  }
  throw new Error('missing ' + key + ' in .env')
}

/** The signed-in user's own access token, as supabase-js stores it. */
async function accessToken(page: Page): Promise<string> {
  const t = await page.evaluate(() => {
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
  if (!t) throw new Error('no supabase access token in localStorage')
  return t
}

async function restHeaders(page: Page) {
  return {
    apikey: envVal('VITE_SUPABASE_PUBLISHABLE_KEY'),
    Authorization: 'Bearer ' + (await accessToken(page)),
    'Content-Type': 'application/json',
  }
}

async function settle(page: Page, ms = 2000) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

/** Pick an option out of a Radix Select by its trigger's position on the page. */
async function chooseFromSelect(page: Page, triggerIndex: number, optionIndex = 0): Promise<string> {
  const trigger = page.locator('button[role="combobox"]').nth(triggerIndex)
  await expect(trigger).toBeEnabled({ timeout: 30000 })
  await trigger.click()
  const options = page.locator('[role="option"]')
  await expect(options.first()).toBeVisible({ timeout: 15000 })
  const chosen = options.nth(optionIndex)
  const label = ((await chosen.textContent()) || '').trim()
  await chosen.click()
  // Radix animates the popover out; wait for it before touching the next one.
  await expect(page.locator('[role="option"]')).toHaveCount(0, { timeout: 10000 })
  return label
}

// ═════════════════════════════════════════════════════════════════════════════
// KNOWN_ISSUES 11 — no teacher could save a question to the bank, by any route
//
// Two causes, one symptom. The payload carried a `school_id` the table does not
// have (PGRST204), and once that was removed the row was refused again by
// `question_bank_active_must_be_keyed` (23514) because no write path had ever
// sent a `chapter_id`. §10.22 says chapter is picked, never typed; the screen
// typed it, so it could not produce one.
// ═════════════════════════════════════════════════════════════════════════════
test.describe('KNOWN_ISSUES 11 — a teacher can save to the question bank', () => {
  test.use({ storageState: authFile('teacher') })

  const TAG = 'E2E qb evidence'

  /**
   * Delete every row this describe block has ever written, as the teacher who
   * wrote it, and return how many went. Called before AND after the save test:
   * "after" keeps a passing run clean, "before" collects what a run that died
   * between the insert and its cleanup left behind — which has happened once,
   * and left a real row in a real bank until it was noticed.
   */
  async function sweep(page: Page): Promise<number> {
    const url = envVal('VITE_SUPABASE_URL')
    const H = await restHeaders(page)
    const like = encodeURIComponent(TAG + '*')
    const list = await page.request.get(
      url + '/rest/v1/question_bank?select=id&question=like.' + like, { headers: H },
    )
    let ids: string[] = []
    try { ids = (JSON.parse(await list.text()) as Array<{ id: string }>).map((r) => r.id) } catch { ids = [] }
    let gone = 0
    for (const id of ids) {
      const d = await page.request.delete(url + '/rest/v1/question_bank?id=eq.' + id, { headers: H })
      if (d.status() === 204 || d.status() === 200) gone++
    }
    return gone
  }

  test('the keying rule is live: a chapterless insert is still refused', async ({ page }) => {
    // NEGATIVE CONTROL. If this ever returns 201, the constraint has been
    // dropped and the test below proves nothing about keying.
    //
    // `created_by` and `class_level` ARE sent, deliberately. Without
    // `created_by` the author fence (20260906030000) refuses first with 42501
    // and the check constraint is never reached — a refusal that looks right
    // and measures nothing. Without `class_level`,
    // `question_bank_class_level_check` fires instead. Both are supplied so
    // the ONLY thing that can refuse this row is the missing chapter.
    await page.goto('/teacher/question-bank', { waitUntil: 'domcontentloaded' })
    await settle(page)
    const url = envVal('VITE_SUPABASE_URL')
    const token = await accessToken(page)
    const H = await restHeaders(page)
    const uid = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
    ).sub as string

    const res = await page.request.post(url + '/rest/v1/question_bank', {
      headers: H,
      data: {
        subject: 'Mathematics',
        class_level: 10,
        question: TAG + ' chapterless — must be refused',
        options: ['1', '2', '3', '4'],
        correct_index: 0,
        created_by: uid,
      },
    })
    const body = await res.text()
    expect(res.status(), 'chapterless insert must be refused: ' + body).toBe(400)
    expect(body).toContain('question_bank_active_must_be_keyed')

    // Nothing should have landed; prove it rather than assume it.
    const q = encodeURIComponent(TAG + ' chapterless — must be refused')
    const left = await page.request.get(
      url + '/rest/v1/question_bank?select=id&question=eq.' + q, { headers: H },
    )
    expect(JSON.parse(await left.text())).toEqual([])
  })

  test('CSV import saves a question keyed to the picked chapter', async ({ page }, testInfo) => {
    test.setTimeout(180000)
    await page.goto('/teacher/question-bank', { waitUntil: 'domcontentloaded' })
    await settle(page)

    // The curriculum tree must actually load — a screen whose pickers are all
    // empty would "pass" a save test by never being able to attempt one.
    await expect(page.getByText('Pick the class, subject and chapter')).toBeVisible({ timeout: 30000 })
    const classLabel = await chooseFromSelect(page, 0, 0)          // Class
    const subjectLabel = await chooseFromSelect(page, 1, 0)        // Subject
    const chapterLabel = await chooseFromSelect(page, 2, 0)        // Chapter
    expect(classLabel, 'class picker is empty').toMatch(/Class \d+/)
    expect(subjectLabel.length, 'subject picker is empty').toBeGreaterThan(0)
    expect(chapterLabel.length, 'chapter picker is empty').toBeGreaterThan(0)
    const classLevel = Number((classLabel.match(/\d+/) || ['0'])[0])

    // Once all three are picked the screen stops warning and lets the save run.
    await expect(page.getByTestId('qb-keying-hint')).toHaveCount(0)

    // Anything a previous run stranded goes first, so the eq. lookup below can
    // only ever match this run's row.
    await sweep(page)

    const question = TAG + ' ' + Date.now() + ' — what is 2+2?'
    await page.getByRole('tab', { name: /CSV Import/i }).click()
    const box = page.getByPlaceholder('What is 2+2?', { exact: false })
    await expect(box).toBeVisible({ timeout: 15000 })
    await box.fill('"' + question + '",2,3,4,5,2,Basic addition')

    const importBtn = page.getByRole('button', { name: /Import to bank/i })
    await expect(importBtn).toBeEnabled({ timeout: 15000 })
    await importBtn.click()

    // The durable proof is the row, not the toast — but the visible text is the
    // fastest way to see WHY when this breaks, so it is captured either way.
    await settle(page, 3000)
    const visible = (await page.evaluate(() => document.body?.innerText ?? '')) || ''
    testInfo.annotations.push({ type: 'toast', description: visible.replace(/\s+/g, ' ').slice(0, 300) })

    const url = envVal('VITE_SUPABASE_URL')
    const H = await restHeaders(page)
    const q = encodeURIComponent(question)
    const found = await page.request.get(
      url + '/rest/v1/question_bank?select=id,chapter_id,class_level,subject,chapter,is_active&question=eq.' + q,
      { headers: H },
    )
    const rows = JSON.parse(await found.text()) as Array<{
      id: string; chapter_id: string | null; class_level: number | null
      subject: string; chapter: string | null; is_active: boolean
    }>
    expect(rows.length, 'the imported question is not in the bank — ' + visible.slice(0, 200)).toBe(1)

    // POSITIVE CONTROL on the keying itself: not merely "a row exists", but
    // that it carries the chapter the teacher picked, at the class they picked.
    expect(rows[0].chapter_id, 'row saved without a chapter_id').toBeTruthy()
    expect(rows[0].class_level).toBe(classLevel)
    expect(rows[0].chapter).toBe(chapterLabel)
    expect(rows[0].subject).toBe(subjectLabel)
    expect(rows[0].is_active).toBe(true)

    // And the chapter_id must point at the chapter whose name was picked —
    // otherwise a row keyed to the wrong chapter would pass everything above.
    const chap = await page.request.get(
      url + '/rest/v1/chapters?select=name&id=eq.' + rows[0].chapter_id,
      { headers: H },
    )
    const chapRows = JSON.parse(await chap.text()) as Array<{ name: string }>
    expect(chapRows[0]?.name).toBe(chapterLabel)

    // Clean up, and assert the cleanup — an unverified restore rots the tenant.
    const del = await page.request.delete(url + '/rest/v1/question_bank?id=eq.' + rows[0].id, { headers: H })
    expect([200, 204]).toContain(del.status())
    const left = await page.request.get(
      url + '/rest/v1/question_bank?select=id&question=eq.' + q, { headers: H },
    )
    expect(JSON.parse(await left.text())).toEqual([])

    // Belt and braces: nothing tagged by this block may survive the run.
    const stragglers = await page.request.get(
      url + '/rest/v1/question_bank?select=id&question=like.' + encodeURIComponent(TAG + '*'),
      { headers: H },
    )
    expect(JSON.parse(await stragglers.text())).toEqual([])
  })
})
