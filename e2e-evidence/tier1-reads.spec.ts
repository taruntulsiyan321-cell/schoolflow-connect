import { test, expect, roleAuthed } from './fixtures'
import { authFile } from './roles'
import type { Page } from '@playwright/test'

/**
 * Tier 1 READS — the four "views" on the day-one list, asserted on CONTENT.
 *
 * `tier1.spec.ts` already drives these URLs, but its criteria are "no uncaught
 * error, no supabase 4xx/5xx, no error banner". A surface that renders its
 * chrome and nothing else passes all four. That is the difference between "the
 * page loaded" and "the parent can see their child's marks", and only the
 * second one is what §10.5 and §10.17 promise.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED. No exact percentage, mark or date. Demo
 * data changes — the attendance test in this suite's sibling file moves a
 * student in and out of Absent — and a test pinned to "83%" would fail on a
 * correct app. Each assertion names the SHAPE that must be there: a labelled
 * figure, a mark written as n/m, the child's own name.
 *
 * An empty surface is not automatically a defect; these four are asserted
 * because the rows behind them were confirmed present first (the parent has one
 * linked child with 5 marks rows; the student has 2 marks and 10 attendance
 * rows). If the seed is emptied, these SHOULD fail — that is the point.
 */

async function load(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(3500)
  return (await page.evaluate(() => document.body?.innerText ?? '')) || ''
}

/** A mark as the app writes it: 13/20, 18/40, 22/40. */
const MARK = /\b\d{1,3}\s*\/\s*\d{1,3}\b/

test.describe('Tier1-R · student', () => {
  test.use({ storageState: authFile('student') })
  test.beforeEach(() => test.skip(!roleAuthed('student'), 'student session not available'))

  test('sees their own attendance, with days actually counted', async ({ page }) => {
    const text = await load(page, '/student/attendance')
    expect(text, 'the attendance figure is labelled').toContain('Overall attendance')
    expect(text, 'a percentage is shown').toMatch(/\d+%/)
    // "10 present-equivalent · 10 days marked" — the count must not be zero,
    // which is what a broken read looks like on this screen.
    expect(text, 'days marked is stated').toMatch(/days marked/i)
    expect(text, 'at least one day is marked').not.toMatch(/\b0 days marked/i)
  })

  test('sees their homework', async ({ page }) => {
    const text = await load(page, '/student/homework')
    expect(text, 'the homework list rendered').toMatch(/MY HOMEWORK/i)
    // Every seeded item carries a subject and a due date; an empty list would
    // carry neither.
    expect(text, 'at least one homework item is listed').toMatch(/Due \d{4}-\d{2}-\d{2}|Due:/i)
  })

  test('sees their exam marks', async ({ page }) => {
    const text = await load(page, '/student/tests')
    expect(text, 'the marks section rendered').toMatch(/EXAM MARKS/i)
    expect(text, 'at least one mark is shown as n/m').toMatch(MARK)
    expect(text, 'the marked-exam count is not zero').not.toMatch(/\b0\s*\n?\s*Marked exams/i)
  })
})

test.describe('Tier1-R · parent', () => {
  test.use({ storageState: authFile('parent') })
  test.beforeEach(() => test.skip(!roleAuthed('parent'), 'parent session not available'))

  test('sees the weekly report with their own child on it', async ({ page }) => {
    const text = await load(page, '/parent')
    expect(text, 'the linked child is named').toMatch(/Arjun Mehta/)
    expect(text, "the child's class is shown").toMatch(/Class 10-A/)
    expect(text, 'an attendance figure is shown').toMatch(/\d+%/)
    expect(text, 'attendance is expressed in days').toMatch(/\d+\/\d+ days/)
  })

  test('sees the exam report for their child', async ({ page }) => {
    const text = await load(page, '/parent/marks')
    expect(text, 'the child is named on the report').toMatch(/Arjun Mehta/)
    expect(text, 'at least one exam mark is shown as n/m').toMatch(MARK)
    // Results reach a parent only after publishResults, so a subject label
    // beside the mark is what distinguishes a real published row from a
    // placeholder.
    expect(text, 'the mark carries its subject').toMatch(/Mathematics|Physics/)
  })
})
