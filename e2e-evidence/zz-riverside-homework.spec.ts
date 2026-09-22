import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { closeAll, eventually, openClassTab, settle, signIn, table } from './riverside'

/**
 * HOMEWORK IN A REAL ORGANISATION — Riverside Public School (20260925200000, 20260925210000), on the deployed app.
 *
 * The whole homework story, told by the people of one school. teacher01 (Priya Sharma, class teacher of 8-A,
 * who teaches it Mathematics) sets homework for 8-A; student 8A-01 (Aarav Sharma) hands in one file; the teacher
 * accepts it and the student is told, once. Aarav's father (parent.8a.01) is told of the homework and of the
 * hand-in, and follows it from "To do" to "Accepted" on My Children. The principal finds it on the Classes tab —
 * twelve sections, 8 A's twenty students, one accepted and nineteen still to do — and downloads both reports;
 * the teacher's and the student's profiles count it. Then the teacher deletes it, and neither the principal's
 * class list nor the parent's screen carries it any more.
 *
 * Its own accounts, signed in through the real /auth form (./riverside.ts), which is why this file may sort
 * after zz-known-issues.
 *
 * WHAT IT CANNOT PUT BACK: the XP the acceptance gives student 8A-01, and the handed-in file in their storage
 * folder. The homework itself goes to the trash.
 */

const TEACHER = 'teacher01@rps.e2e.test'
const STUDENT = 'student.8a.01@rps.e2e.test'
const PARENT = 'parent.8a.01@rps.e2e.test'
const PRINCIPAL = 'principal@rps.e2e.test'
const STUDENT_NAME = 'Aarav Sharma'
const TAG = 'RPS homework'

async function download(page: Page, button: Locator): Promise<{ name: string; lines: string[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()])
  const path = await file.path()
  return { name: file.suggestedFilename(), lines: (path ? readFileSync(path, 'utf8') : '').split('\n').filter(Boolean) }
}

test.describe('Riverside Public School · homework, told by its people', () => {
  test('set → handed in → accepted, followed by the parent → on the principal\'s Classes tab, both reports and both profiles → deleted', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(600000)
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const title = `${TAG} ${stamp}`
    const file = {
      name: `rps-hand-in-${stamp}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n% Riverside evidence run ${stamp}\n%%EOF\n`),
    }

    const teacher = await signIn(browser, TEACHER, /\/teacher/)
    const student = await signIn(browser, STUDENT, /\/student/)
    const parent = await signIn(browser, PARENT, /\/parent/)
    const principal = await signIn(browser, PRINCIPAL, /\/principal/)
    const t = teacher.page
    const s = student.page
    const pa = parent.page
    const p = principal.page

    const openTeacherHomework = async () => {
      await openClassTab(t, '8 A', 'Homework')
      await expect(t.getByRole('button', { name: 'New homework' })).toBeVisible({ timeout: 45000 })
    }
    const teacherCards = () =>
      t.locator('div.p-4.bg-surface').filter({ hasText: TAG }).filter({ has: t.getByRole('button', { name: 'Delete' }) })
    const deleteRiversideHomework = async (): Promise<number> => {
      let deleted = 0
      for (let i = 0; i < 25; i++) {
        const n = await teacherCards().count()
        if (n === 0) break
        const btn = teacherCards().last().getByRole('button', { name: 'Delete' })
        await expect(btn).toBeEnabled({ timeout: 30000 })
        t.once('dialog', (d) => void d.accept())
        await btn.click()
        await expect(teacherCards(), 'the deleted card leaves the list').toHaveCount(n - 1, { timeout: 30000 })
        deleted++
      }
      return deleted
    }
    const studentCard = () => s.locator('div.p-4.rounded-xl').filter({ hasText: title }).last()
    const openStudentHomework = async () => {
      await s.goto('/student/homework', { waitUntil: 'domcontentloaded' })
      await settle(s)
      await expect(studentCard(), 'the homework reaches the student').toBeVisible({ timeout: 45000 })
    }
    /** The homework on the parent's My Children → Homework tab. */
    const parentCard = () => pa.getByRole('main').locator('div.p-4').filter({ hasText: title })
    const openParentHomework = async () => {
      await pa.goto('/parent/children', { waitUntil: 'domcontentloaded' })
      await settle(pa)
      await expect(pa.getByRole('main'), 'the parent\'s child is on My Children').toContainText(STUDENT_NAME, { timeout: 45000 })
      await pa.getByRole('main').getByRole('button', { name: 'Homework', exact: true }).click()
      await expect(pa.getByText(/^\d+ homework$/), 'the child\'s homework list loaded').toBeVisible({ timeout: 45000 })
    }
    const parentNotification = (heading: string) =>
      pa.getByRole('button').filter({ hasText: heading }).filter({ hasText: title })
    const principalClasses = async () => {
      await p.goto('/principal', { waitUntil: 'domcontentloaded' })
      await p.locator('aside').getByRole('button', { name: 'Classes', exact: true }).click()
      const classes = table(p, 'Class', 'Handed in by deadline', 'Awaiting review')
      await expect(classes.getByRole('button'), 'Riverside\'s twelve sections').toHaveCount(12, { timeout: 45000 })
      await expect(classes).not.toContainText('…', { timeout: 45000 })
      return classes.getByRole('button').filter({ hasText: /^8 A/ })
    }

    try {
      // ── 1. THE CLASS TEACHER SETS HOMEWORK FOR 8-A ─────────────────────
      await openTeacherHomework()
      await deleteRiversideHomework() // whatever a failed run left
      await t.getByRole('button', { name: 'New homework' }).click()
      await t.getByPlaceholder('Title *').fill(title)
      await t.getByPlaceholder('The question').fill('Riverside evidence run — set, hand in, accept.')
      const d = new Date(Date.now() + 7 * 24 * 3600 * 1000)
      const pad = (x: number) => String(x).padStart(2, '0')
      await t.locator('input[type="datetime-local"]').first().fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T17:00`)
      await t.getByRole('button', { name: 'Publish', exact: true }).click()
      await expect(
        t.locator('div.p-4.bg-surface').filter({ hasText: title }).filter({ has: t.getByRole('button', { name: 'Hand-ins' }) }),
        `the teacher's list shows the released homework — ${title}`,
      ).toHaveCount(1, { timeout: 45000 })

      // ── 2. THE PARENT IS TOLD, AND SEES IT TO DO ───────────────────────
      await eventually(pa, '/parent/notifications', () => parentNotification('New homework'), 'the parent is told "New homework" about this homework')
      await expect(parentNotification('New homework'), 'once').toHaveCount(1)
      await openParentHomework()
      await expect(parentCard(), 'the homework is on the parent\'s screen, to do').toContainText('To do', { timeout: 45000 })

      // ── 3. THE STUDENT HANDS IN ONE FILE ───────────────────────────────
      await openStudentHomework()
      await studentCard().getByRole('button', { name: 'Hand in', exact: true }).click()
      await studentCard().locator('input[type="file"]').setInputFiles(file)
      await expect(studentCard().getByRole('button', { name: 'Replace file' })).toBeVisible({ timeout: 45000 })
      await studentCard().getByRole('button', { name: 'Hand in', exact: true }).click()
      await settle(s, 2500)
      await openStudentHomework()
      await expect(studentCard(), 'the hand-in reads as awaiting review after a reload').toContainText('Handed in — awaiting review', { timeout: 30000 })
      await eventually(pa, '/parent/notifications', () => parentNotification('Work submitted'), 'the parent is told the work was handed in')

      // ── 4. THE TEACHER ACCEPTS; THE STUDENT IS TOLD, ONCE ──────────────
      await openTeacherHomework()
      await t.locator('div.p-4.bg-surface').filter({ hasText: title }).getByRole('button', { name: 'Hand-ins' }).last().click()
      const awaiting = t.locator('div.p-3').filter({ hasText: 'Handed in — awaiting review' }).filter({ has: t.getByRole('button', { name: 'Accept', exact: true }) })
      await expect(awaiting, 'the review lists the one hand-in awaiting a decision').toHaveCount(1, { timeout: 45000 })
      await expect(awaiting, 'it is the student who handed in').toContainText(STUDENT_NAME)
      await awaiting.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect(t.locator('div.p-3').filter({ hasText: STUDENT_NAME }).filter({ hasText: 'Accepted' })).toHaveCount(1, { timeout: 30000 })
      await s.goto('/student/notifications', { waitUntil: 'domcontentloaded' })
      await settle(s)
      await expect(
        s.getByRole('button').filter({ hasText: 'Homework accepted' }).filter({ hasText: title }),
        'the student is told "Homework accepted" about this homework, once',
      ).toHaveCount(1, { timeout: 60000 })
      await openParentHomework()
      await expect(parentCard(), 'the parent sees it accepted, with the file handed in').toContainText('Accepted', { timeout: 45000 })
      await expect(parentCard()).toContainText(file.name)

      // ── 5. THE PRINCIPAL: CLASSES TAB, THE HOMEWORK, BOTH REPORTS ───────
      const eightA = await principalClasses()
      // Class, 20 students, 1 homework, no rate until it closes, 0 waiting on a teacher.
      await expect(eightA, '8 A on the principal\'s list').toHaveText('8 A201—0', { timeout: 45000 })
      await eightA.click()
      const hwRow = table(p, 'Homework', 'Deadline', 'Handed in', 'State').getByRole('button').filter({ hasText: title })
      await expect(hwRow, 'the class\'s homework, with its hand-ins so far').toContainText('1 / 20', { timeout: 45000 })
      await expect(hwRow).toContainText('Open')
      await hwRow.click()
      const reportButton = p.getByRole('button', { name: 'Download report', exact: true })
      await expect(reportButton).toBeVisible({ timeout: 45000 })
      const standings = table(p, 'Roll', 'Student', 'Standing', 'File').locator(':scope > div').filter({ hasNotText: 'Standing' })
      await expect(standings, 'every student of 8-A is listed').toHaveCount(20)
      await expect(standings.filter({ hasText: STUDENT_NAME }), 'the student who handed in reads Accepted, with their file').toContainText('Accepted')
      await expect(standings.filter({ hasText: STUDENT_NAME })).toContainText(file.name)
      await expect(standings.filter({ hasText: 'To do' }), 'the other nineteen still have it to do').toHaveCount(19)
      await expect(p.getByRole('button', { name: /^(Accept|Reject)$/ }), 'a principal is offered no decision').toHaveCount(0)

      const report = await download(p, reportButton)
      expect(report.name).toMatch(/^homework-rps-homework-\d+-\d{4}-\d{2}-\d{2}\.csv$/)
      expect(report.lines[0]).toBe('Roll,Student,Done,Standing,Handed in at,Decided at,File')
      expect(report.lines.length - 1, 'one report row per student').toBe(20)
      const done = report.lines.filter((l) => l.includes('"Yes"'))
      expect(done, 'exactly one student did it').toHaveLength(1)
      expect(done[0]).toContain(`"${STUDENT_NAME}"`)
      expect(done[0]).toContain('"Accepted"')

      await p.getByRole('button', { name: '← Back' }).click()
      await p.getByRole('tab', { name: 'Students' }).click()
      const classReportButton = p.getByRole('button', { name: 'Download class report' })
      await expect(classReportButton).toBeVisible({ timeout: 45000 })
      const records = table(p, 'Roll', 'Student', 'Missed', 'Still open').locator(':scope > div').filter({ hasNotText: 'Still open' })
      await expect(records).toHaveCount(20)
      // Roll, name, set, done, missed, still open.
      await expect(records.filter({ hasText: STUDENT_NAME })).toHaveText(`1${STUDENT_NAME}1100`)
      const classReport = await download(p, classReportButton)
      expect(classReport.name).toMatch(/^homework-8-a-\d{4}-\d{2}-\d{2}\.csv$/)
      expect(classReport.lines.length - 1).toBe(20)
      expect(classReport.lines.find((l) => l.includes(`"${STUDENT_NAME}"`))).toBe(`"1","${STUDENT_NAME}","1","1","1","0","0","0"`)
      await p.getByRole('tab', { name: 'Tests' }).click()
      await expect(p.getByText(/^\d+ tests?$/)).toBeVisible({ timeout: 45000 })

      // ── 6. BOTH PROFILES COUNT IT ──────────────────────────────────────
      await t.goto('/teacher/profile', { waitUntil: 'domcontentloaded' })
      const section = t.locator('div.bg-surface').filter({ has: t.getByText('Homework You Have Set', { exact: true }) }).last()
      await expect(section).toContainText(title, { timeout: 45000 })
      await expect(section).toContainText('1 of 20 handed in')
      await expect(section).toContainText('0Waiting for your decision')

      await s.goto('/student/profile', { waitUntil: 'domcontentloaded' })
      const figure = (label: string) => s.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]')
      await expect(figure('Homework handed in')).toHaveText('1', { timeout: 45000 })
      await expect(figure('Still to do')).toHaveText('0')
      await expect(figure('Missed at the deadline')).toHaveText('0')

      // ── 7. DELETED: OUT OF EVERY COUNT, AND OFF THE PARENT'S SCREEN ────
      await openTeacherHomework()
      expect(await deleteRiversideHomework(), 'the teacher deleted the homework this run set').toBeGreaterThan(0)
      await expect(await principalClasses(), 'the principal\'s list no longer counts it').toHaveText('8 A200—0', { timeout: 45000 })
      await openParentHomework()
      await expect(parentCard(), 'the deleted homework leaves the parent\'s screen').toHaveCount(0, { timeout: 45000 })

      expect([...teacher.errors, ...student.errors, ...parent.errors, ...principal.errors], 'no uncaught error on any screen').toEqual([])
      testInfo.annotations.push({ type: 'riverside-homework', description: `ok: ${title}` })
    } finally {
      await closeAll(teacher, student, parent, principal)
    }
  })
})
