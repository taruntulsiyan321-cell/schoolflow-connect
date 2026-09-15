import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect, roleAuthed } from './fixtures'
import { authFile } from './roles'

/**
 * HOMEWORK PAST THE CLASS — on the deployed app, as each role (KNOWN_ISSUES 56, spec rules 48–52).
 *
 * The principal's Classes tab read live: real classes, a released homework's standings with no
 * decision offered, the report the principal downloads, the class report, the class's tests. The
 * teacher's and the student's profiles carry homework. A parent's notification opens a parent page.
 *
 * Reads only. The one write is a parent notification marked read by opening it, and a read one is
 * chosen when there is one.
 *
 * Asserted on SHAPE, not on figures demo data moves: a dated filename, a CSV whose header is the
 * report's and whose rows are the screen's rows, counts that are numbers. The CSV is the file the
 * browser actually downloads, so what the unit tests cannot see — the name `exportCSV` finally
 * gives it — is checked here.
 */

/** The bordered table carrying every one of these headers. */
function table(page: Page, ...headers: string[]): Locator {
  let t = page.locator('div.border.bg-card')
  for (const h of headers) t = t.filter({ hasText: h })
  return t.last()
}

async function download(page: Page, button: Locator): Promise<{ name: string; lines: string[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()])
  const path = await file.path()
  const text = path ? readFileSync(path, 'utf8') : ''
  return { name: file.suggestedFilename(), lines: text.split('\n').filter(Boolean) }
}

/** A report file: `homework-<slug>-<yyyy-mm-dd>.csv`, one extension. */
const REPORT_FILE = /^homework-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv$/

test.describe('Homework family · principal Classes tab', () => {
  test.use({ storageState: authFile('principal') })
  test.beforeEach(() => test.skip(!roleAuthed('principal'), 'principal session not available'))

  test('real classes, a homework\'s standings and its report, the class report and tests', async ({ page, signals }) => {
    test.setTimeout(240000)
    await page.goto('/principal', { waitUntil: 'domcontentloaded' })
    await page.locator('aside').getByRole('button', { name: 'Classes', exact: true }).click()

    const classes = table(page, 'Class', 'Handed in by deadline', 'Awaiting review')
    const classRows = classes.getByRole('button')
    await expect(classRows.first(), 'the school\'s classes are listed').toBeVisible({ timeout: 45000 })
    await expect(classes, 'every class\'s homework figures loaded').not.toContainText('…', { timeout: 45000 })
    const classCount = await classRows.count()
    for (const text of await classRows.allTextContents()) {
      // The fixture design's classes were "9 — A"; a live class is its own name and section.
      expect(text, 'no fixture class on the tab').not.toMatch(/\s—\s/)
    }

    // A class with released homework that was set to at least one student.
    let opened = false
    for (let i = 0; i < classCount && !opened; i++) {
      await classRows.nth(i).click()
      const homework = table(page, 'Homework', 'Deadline', 'Handed in', 'State')
      await expect(
        homework.getByRole('button').first().or(page.getByText('No homework released to this class yet.')),
      ).toBeVisible({ timeout: 45000 })
      const rows = homework.getByRole('button')
      const n = await rows.count()
      for (let j = 0; j < n; j++) {
        const handedIn = (await rows.nth(j).locator('div.w-24').first().textContent()) ?? ''
        const m = handedIn.match(/(\d+) \/ (\d+)/)
        if (m && Number(m[2]) > 0) {
          await rows.nth(j).click()
          opened = true
          break
        }
      }
      if (!opened) await page.getByRole('button', { name: '← Back' }).click()
    }
    expect(opened, 'some class has released homework set to students').toBe(true)

    // The homework: every student's standing, and nothing to decide.
    await expect(page.getByText(/Accepting or rejecting a hand-in is for the teachers of/)).toBeVisible({ timeout: 45000 })
    const reportButton = page.getByRole('button', { name: 'Download report', exact: true })
    await expect(reportButton, 'the standings loaded and the report is offered').toBeVisible({ timeout: 45000 })
    const standings = table(page, 'Roll', 'Student', 'Standing', 'File')
    const standingRows = (await standings.locator(':scope > div').count()) - 1
    expect(standingRows, 'students are listed').toBeGreaterThan(0)
    expect(await page.getByRole('button', { name: /^(Accept|Reject)$/ }).count(), 'a principal is offered no decision').toBe(0)

    const report = await download(page, reportButton)
    expect(report.name, 'the report file has one extension').toMatch(REPORT_FILE)
    expect(report.lines[0]).toBe('Roll,Student,Done,Standing,Handed in at,Decided at,File')
    expect(report.lines.length - 1, 'one report row per student on the screen').toBe(standingRows)
    for (const line of report.lines.slice(1)) expect(line, 'each row says whether it was done').toMatch(/","(Yes|No)","/)

    // The class: each student's record, and the class report.
    await page.getByRole('button', { name: '← Back' }).click()
    await page.getByRole('tab', { name: 'Students' }).click()
    const classReportButton = page.getByRole('button', { name: 'Download class report' })
    await expect(classReportButton).toBeVisible({ timeout: 45000 })
    const students = table(page, 'Roll', 'Student', 'Missed', 'Still open')
    const studentRows = (await students.locator(':scope > div').count()) - 1
    expect(studentRows, 'the roll is listed').toBeGreaterThan(0)
    const classReport = await download(page, classReportButton)
    expect(classReport.name, 'the class report file has one extension').toMatch(REPORT_FILE)
    expect(classReport.lines[0]).toBe('Roll,Student,Homework set,Done,Accepted,Awaiting review,Missed at the deadline,Still to do')
    expect(classReport.lines.length - 1, 'one class-report row per student on the screen').toBe(studentRows)

    // The class's tests, through the Tests tab's own table.
    await page.getByRole('tab', { name: 'Tests' }).click()
    await expect(page.getByText(/^\d+ tests?$/)).toBeVisible({ timeout: 45000 })

    expect(signals.pageErrors, 'no uncaught error').toEqual([])
    expect(signals.badResponses.filter((r) => r.supabase), 'no failed database request').toEqual([])
  })
})

test.describe('Homework family · teacher profile', () => {
  test.use({ storageState: authFile('teacher') })
  test.beforeEach(() => test.skip(!roleAuthed('teacher'), 'teacher session not available'))

  test('carries the homework they have set', async ({ page, signals }) => {
    await page.goto('/teacher/profile', { waitUntil: 'domcontentloaded' })
    const section = page.locator('div.bg-surface').filter({ has: page.getByText('Homework You Have Set', { exact: true }) }).last()
    await expect(section).toBeVisible({ timeout: 45000 })
    await expect(section).not.toContainText('Loading your homework', { timeout: 45000 })
    await expect(section).not.toContainText('Could not load')
    const text = (await section.textContent()) ?? ''
    expect(text, 'the section states what was set, or that nothing was').toMatch(/\d+Homework set|You have not set homework yet/)
    if (/\d+Homework set/.test(text)) {
      expect(text).toMatch(/\d+Released/)
      expect(text).toMatch(/\d+Waiting for your decision/)
    }
    expect(signals.pageErrors, 'no uncaught error').toEqual([])
  })
})

test.describe('Homework family · student profile', () => {
  test.use({ storageState: authFile('student') })
  test.beforeEach(() => test.skip(!roleAuthed('student'), 'student session not available'))

  test('counts homework handed in, still to do and missed, and opens the homework', async ({ page, signals }) => {
    await page.goto('/student/profile', { waitUntil: 'domcontentloaded' })
    const figure = (label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]')
    await expect(page.getByText('Homework handed in', { exact: true })).toBeVisible({ timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    let total = 0
    for (const label of ['Homework handed in', 'Still to do', 'Missed at the deadline']) {
      await expect(figure(label), `${label} is a count`).toHaveText(/^\d+$/)
      total += Number(await figure(label).textContent())
    }
    // This account has homework set to it (tier1-reads) — three zeros would be a read that failed.
    expect(total, 'the student\'s homework is counted').toBeGreaterThan(0)
    await page.getByRole('button', { name: /Open your homework/ }).click()
    await expect(page).toHaveURL(/\/student\/homework/)
    expect(signals.pageErrors, 'no uncaught error').toEqual([])
  })
})

test.describe('Homework family · parent notifications', () => {
  test.use({ storageState: authFile('parent') })
  test.beforeEach(() => test.skip(!roleAuthed('parent'), 'parent session not available'))

  test('a notification opens a parent page, and none points into the student panel', async ({ page, signals }) => {
    await page.goto('/parent/notifications', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/unread of \d+ total/)).toBeVisible({ timeout: 45000 })
    const opens = page.locator('[role="button"].cursor-pointer')
    expect(await opens.count(), 'notifications that open a parent page').toBeGreaterThan(0)
    // Every notification this demo parent holds carries a link (measured 2026-09-15), so one that
    // opens nothing is one whose link is still the student's.
    expect(await page.locator('[role="button"].cursor-default').count(), 'no notification points into the student panel').toBe(0)

    const read = page.locator('[role="button"].cursor-pointer.bg-surface')
    await ((await read.count()) > 0 ? read.first() : opens.first()).click()
    await expect(page).not.toHaveURL(/\/parent\/notifications/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/parent(\/(children|marks|notices|insights|profile))?\/?$/)
    expect(signals.pageErrors, 'no uncaught error').toEqual([])
  })
})
