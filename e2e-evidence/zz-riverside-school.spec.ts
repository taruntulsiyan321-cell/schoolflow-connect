import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { closeAll, eventually, openClassTab, settle, signIn, type Person } from './riverside'

/**
 * A SCHOOL AT WORK — Riverside Public School (20260925210000), on the deployed app.
 *
 * Not a demo kept tidy: a school used the way a real one is, so that what breaks under real use shows. Each thing
 * is done by the person whose job it is and read by the people it reaches. teacher01 (Priya Sharma) is class
 * teacher of 8-A and teaches it Mathematics: she takes 8-A's register, sets a Mathematics test, holds a class exam
 * whose Mathematics marks she enters, finalises and publishes, and posts a notice to 8-A. Student 8A-01 (Aarav
 * Sharma) and Aarav's father (parent.8a.01) see every one of them; a parent in another class (parent.9b.01) does not
 * see 8-A's notice; and the mother of 8-A 02 and 11-A 10 (parent.8a.02) sees both her children, each in their own
 * class.
 *
 * NOTHING IS TIDIED AWAY. A real school keeps the tests its children sat, the exams it published and the notices it
 * posted, and so does Riverside: every run adds to the school's record, as a real term does. So every assertion is
 * about what THIS run did — its own stamped titles — and never about a count a previous run could move. A step that
 * fails is a defect of the app to be fixed, not a script to be bent.
 */

const TEACHER = 'teacher01@rps.e2e.test'
const STUDENT = 'student.8a.01@rps.e2e.test'
const PARENT = 'parent.8a.01@rps.e2e.test'
const STUDENT_NAME = 'Aarav Sharma'

const stampNow = () => new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)

test.describe('Riverside Public School · a school at work', () => {
  test('attendance: the class teacher takes 8-A\'s register, and the student and their parent see the day', async ({ browser }) => {
    test.setTimeout(300000)
    let teacher: Person | undefined
    let student: Person | undefined
    let parent: Person | undefined
    try {
      teacher = await signIn(browser, TEACHER, /\/teacher/)
      const t = teacher.page
      const save = () => t.getByRole('button', { name: /Save Attendance/ })
      const openRegister = async () => {
        await t.goto('/teacher/attendance', { waitUntil: 'domcontentloaded' })
        await settle(t)
        // Her six sections are listed; only 8-A carries CT, and only the class teacher may mark it.
        await t.getByRole('button', { name: /^8 A · Mathematics\s*CT$/ }).click()
        await expect(t.getByText(/^20 students$/), '8-A\'s twenty on the register').toBeVisible({ timeout: 45000 })
        await expect(save(), 'the class teacher may mark 8-A').toBeEnabled({ timeout: 45000 })
      }
      await openRegister()
      const before = await t.locator('body').innerText()
      const submitted = before.includes('Attendance submitted')
      const draft = before.includes('Not submitted yet')
      expect(submitted !== draft, `the day reports exactly one save state (submitted=${submitted}, draft=${draft})`).toBe(true)

      if (draft) {
        await t.getByRole('button', { name: 'All Present' }).click()
        await save().click()
        await expect(t.getByText('Attendance submitted'), 'the register was submitted').toBeVisible({ timeout: 45000 })
      } else {
        // §10.5: a submitted day is the admin's; a second submission is refused, and says why.
        await t.getByRole('button', { name: /^(Mark Absent|Absent)$/ }).first().click()
        await save().click()
        await expect(t.getByText(/has already been submitted\. Only an admin can change it/i)).toBeVisible({ timeout: 45000 })
      }
      await openRegister()
      await expect(t.getByText('Attendance submitted'), 'the day reads as submitted after a reload').toBeVisible({ timeout: 45000 })
      await expect(t.getByRole('button', { name: /^Absent$/ }), 'nobody in 8-A is marked absent').toHaveCount(0)

      student = await signIn(browser, STUDENT, /\/student/)
      await student.page.goto('/student/attendance', { waitUntil: 'domcontentloaded' })
      await settle(student.page, 3000)
      await expect(student.page.getByText('Overall attendance').first()).toBeVisible({ timeout: 45000 })
      const studentView = await student.page.locator('body').innerText()
      expect(studentView, 'the student\'s days are counted').toMatch(/days marked/i)
      expect(studentView, 'at least today is marked').not.toMatch(/\b0 days marked/i)

      parent = await signIn(browser, PARENT, /\/parent/)
      await parent.page.goto('/parent', { waitUntil: 'domcontentloaded' })
      await settle(parent.page, 3000)
      const main = parent.page.getByRole('main')
      await expect(main, 'the parent\'s child').toContainText(STUDENT_NAME, { timeout: 45000 })
      await expect(main, 'the child\'s class').toContainText('Class 8-A')
      await expect(main.getByText(/present today/i), 'the parent sees the child present today').toBeVisible({ timeout: 45000 })
      await expect(main, 'attendance in days, with today among them').toContainText(/\b[1-9]\d*\/[1-9]\d* days/)

      expect([...teacher.errors, ...student.errors, ...parent.errors], 'no uncaught error on any screen').toEqual([])
    } finally {
      await closeAll(teacher, student, parent)
    }
  })

  test('a class test: set for 8-A Mathematics, sat by the student, its mark read by the student and their parent', async ({ browser }) => {
    test.setTimeout(480000)
    const title = `RPS test ${stampNow()}`
    let teacher: Person | undefined
    let student: Person | undefined
    let parent: Person | undefined
    try {
      teacher = await signIn(browser, TEACHER, /\/teacher/)
      const t = teacher.page
      await openClassTab(t, '8 A', 'Tests')
      await expect(t.getByRole('button', { name: /create test/i }).first()).toBeVisible({ timeout: 45000 })
      await t.getByRole('button', { name: /create test/i }).first().click()
      await t.getByPlaceholder('Title *').fill(title)
      await t.getByPlaceholder('Max marks').fill('5')
      await t.getByRole('button', { name: /publish now/i }).first().click()
      await t.getByRole('button', { name: /next: choose source/i }).click()
      await t.getByRole('button', { name: /Write the questions yourself/ }).click()
      await t.getByPlaceholder('Question text *').fill('What is 2 + 3?')
      await t.getByPlaceholder('Option A').fill('4')
      await t.getByPlaceholder('Option B').fill('5')
      await t.getByPlaceholder('Option C').fill('6')
      await t.getByPlaceholder('Option D').fill('7')
      await t.getByRole('button', { name: 'Mark option B correct' }).click()
      await t.getByPlaceholder('Marks').fill('5')
      await t.getByRole('button', { name: /add question/i }).click()
      await expect(t.getByText(/total questions:\s*1/i).first(), 'the composer holds the question').toBeVisible({ timeout: 10000 })
      await t.getByRole('button', { name: /next: review/i }).click()
      await t.getByRole('button', { name: /^Publish$/ }).click()
      await expect(t.getByText(/Published to this class — 1 question\(s\), 5 marks/), 'the test is published for 8-A').toBeVisible({ timeout: 45000 })

      student = await signIn(browser, STUDENT, /\/student/)
      const s = student.page
      const card = () => s.locator('div.p-4.rounded-xl').filter({ hasText: title })
      await s.goto('/student/tests', { waitUntil: 'domcontentloaded' })
      await settle(s)
      await expect(card(), 'the test reaches the student').toHaveCount(1, { timeout: 60000 })
      await card().getByRole('link', { name: /Attempt/ }).click()
      await expect(s, 'the attempt route').toHaveURL(/\/student\/test\/[0-9a-f-]+\/attempt/i, { timeout: 30000 })
      await expect(s.getByText(/Question\s+1\s+of\s+1/i).first(), 'the question is on screen').toBeVisible({ timeout: 45000 })
      await expect(s.getByText(/\b0\s*\/\s*1\s+answered/i).first(), 'control: nothing answered yet').toBeVisible({ timeout: 20000 })
      await s.getByRole('button', { name: /^[A-D]\s*5$/ }).first().click()
      await s.waitForTimeout(3000)
      await expect(s.getByText(/\b1\s*\/\s*1\s+answered/i).first(), 'the answer is recorded, and survives').toBeVisible({ timeout: 10000 })
      // Submit asks once through window.confirm; an unaccepted dialog cancels it.
      const confirmed = s.waitForEvent('dialog').then(async (d) => { const m = d.message(); await d.accept(); return m })
      await s.getByRole('button', { name: /^Submit$/ }).click()
      expect(await confirmed, 'nothing is left unanswered').toBe('Submit your paper? You cannot reopen it.')
      await expect(s, 'submitting lands on the result').toHaveURL(/\/student\/test\/[0-9a-f-]+\/result/i, { timeout: 45000 })
      await s.goto('/student/tests', { waitUntil: 'domcontentloaded' })
      await settle(s)
      await expect(card(), 'the student\'s list carries the mark: every mark of the test').toContainText('Scored 5 / 5', { timeout: 45000 })

      parent = await signIn(browser, PARENT, /\/parent/)
      const pa = parent.page
      await pa.goto('/parent/marks', { waitUntil: 'domcontentloaded' })
      await settle(pa, 3000)
      const row = pa.getByRole('main').locator('div.p-3').filter({ hasText: title })
      await expect(row, 'the test is on the parent\'s Test Results').toHaveCount(1, { timeout: 60000 })
      await expect(row, 'with the child\'s score: one of one right').toContainText('1/1')
      await expect(row.getByRole('button', { name: 'Report' }), 'and the child\'s report, now that they have sat it').toBeVisible()

      expect([...teacher.errors, ...student.errors, ...parent.errors], 'no uncaught error on any screen').toEqual([])
    } finally {
      await closeAll(teacher, student, parent)
    }
  })

  test('an exam: 8-A\'s five subjects, a Mathematics mark entered, finalised and published, read by the student and their parent', async ({ browser }) => {
    test.setTimeout(480000)
    const examName = `RPS exam ${stampNow()}`
    const mark = '42'
    let teacher: Person | undefined
    let student: Person | undefined
    let parent: Person | undefined
    try {
      teacher = await signIn(browser, TEACHER, /\/teacher/)
      const t = teacher.page
      // The innermost element holding both this exam's name and its own Review / publish control.
      const examCard = () =>
        t.locator('div').filter({ hasText: examName }).filter({ has: t.getByRole('button', { name: 'Review / publish' }) }).last()
      const openExams = async () => {
        await openClassTab(t, '8 A', 'Exams & Marks')
        await settle(t)
        await expect(t.getByRole('button', { name: 'New class exam' }), 'the exam list is showing').toBeVisible({ timeout: 45000 })
      }
      await openExams()
      await t.getByRole('button', { name: 'New class exam' }).click()
      await t.getByPlaceholder('Exam name * e.g. Unit Test 1').fill(examName)
      await t.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10))
      await t.getByRole('button', { name: 'Create exam' }).click()
      await expect(examCard(), 'the exam is in 8-A\'s list').toBeVisible({ timeout: 45000 })
      // The sitting takes its subjects from who teaches 8-A: exactly the five of its stream.
      for (const subject of ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science']) {
        await expect(examCard(), `the exam covers ${subject}`).toContainText(subject)
      }
      for (const subject of ['Physics', 'Chemistry', 'Biology']) {
        await expect(examCard(), `the exam does not cover ${subject}, which 8-A is not taught`).not.toContainText(subject)
      }

      await examCard().getByRole('button', { name: 'Mathematics marks' }).click()
      await expect(t.locator('input[type="number"]'), 'the Mathematics sheet lists 8-A\'s twenty').toHaveCount(20, { timeout: 45000 })
      await t.locator('div.p-3').filter({ hasText: `#1 · ${STUDENT_NAME}` }).locator('input[type="number"]').fill(mark)
      await t.getByRole('button', { name: 'Save marks' }).click()
      await expect(t.getByText('Marks saved'), 'the mark was saved').toBeVisible({ timeout: 45000 })

      await openExams()
      await examCard().getByRole('button', { name: 'Review / publish' }).click()
      await settle(t)
      await t.getByRole('button', { name: 'Finalize all subjects' }).click()
      await expect(t.getByText('Exam finalized — marks locked')).toBeVisible({ timeout: 45000 })
      await openExams()
      await examCard().getByRole('button', { name: 'Review / publish' }).click()
      await settle(t)
      await expect(t.getByRole('button', { name: 'Publish Results' }), 'publish is offered once the marks are locked').toBeEnabled({ timeout: 45000 })
      await t.getByRole('button', { name: 'Publish Results' }).click()
      await expect(t.getByText('Results published to students & parents')).toBeVisible({ timeout: 45000 })
      await openExams()
      await expect(examCard(), 'the exam reads as published after a reload').toContainText('Published', { timeout: 45000 })

      student = await signIn(browser, STUDENT, /\/student/)
      const s = student.page
      await s.goto('/student/tests', { waitUntil: 'domcontentloaded' })
      await settle(s, 3000)
      const studentMark = s.locator('div.p-4.rounded-xl').filter({ hasText: examName })
      await expect(studentMark, 'the student reads their mark').toContainText(`${mark}/100`, { timeout: 60000 })
      await expect(studentMark).toContainText('Mathematics')

      parent = await signIn(browser, PARENT, /\/parent/)
      const pa = parent.page
      await pa.goto('/parent/marks', { waitUntil: 'domcontentloaded' })
      await settle(pa, 3000)
      const parentMark = pa.getByRole('main').locator('div.p-3').filter({ hasText: examName })
      await expect(parentMark, 'the parent reads the child\'s mark').toContainText(`${mark}/100`, { timeout: 60000 })
      await expect(parentMark).toContainText('Mathematics')

      expect([...teacher.errors, ...student.errors, ...parent.errors], 'no uncaught error on any screen').toEqual([])
    } finally {
      await closeAll(teacher, student, parent)
    }
  })

  test('a notice: posted to 8-A, read by the student and their parent, not by a parent of 9-B', async ({ browser }) => {
    test.setTimeout(480000)
    const title = `RPS notice ${stampNow()}`
    let teacher: Person | undefined
    let student: Person | undefined
    let parent: Person | undefined
    let otherParent: Person | undefined
    try {
      teacher = await signIn(browser, TEACHER, /\/teacher/)
      const t = teacher.page
      await t.goto('/teacher/announcements', { waitUntil: 'domcontentloaded' })
      await settle(t)
      await expect(t.getByRole('button', { name: 'New Announcement' })).toBeEnabled({ timeout: 45000 })
      await t.getByRole('button', { name: 'New Announcement' }).click()
      const form = t.locator('div').filter({ has: t.getByText('New Announcement', { exact: true }) }).filter({ has: t.locator('textarea') }).last()
      await form.locator('input').first().fill(title)
      await form.locator('textarea').fill('Riverside evidence run — a notice to 8-A.')
      await form.locator('select').nth(0).selectOption({ label: '8 A' })
      await form.locator('select').nth(2).selectOption('published')
      await form.getByRole('button', { name: 'Publish', exact: true }).click()
      await expect(t.getByText('Announcement published'), 'the notice is published').toBeVisible({ timeout: 45000 })

      const notice = (page: Page) => page.getByRole('button').filter({ hasText: title })
      student = await signIn(browser, STUDENT, /\/student/)
      await student.page.goto('/student/notices', { waitUntil: 'domcontentloaded' })
      await settle(student.page, 3000)
      await expect(notice(student.page), 'the student reads it').toHaveCount(1, { timeout: 60000 })

      parent = await signIn(browser, PARENT, /\/parent/)
      const pa = parent.page
      await pa.goto('/parent/notices', { waitUntil: 'domcontentloaded' })
      await settle(pa, 3000)
      await expect(notice(pa), 'the parent reads it').toHaveCount(1, { timeout: 60000 })
      await eventually(pa, '/parent/notifications', () => notice(pa), 'the parent is notified of it')

      otherParent = await signIn(browser, 'parent.9b.01@rps.e2e.test', /\/parent/)
      const op = otherParent.page
      await op.goto('/parent/notices', { waitUntil: 'domcontentloaded' })
      await settle(op, 3000)
      await expect(op.getByText(/AnnouncementService · \d+ published/), 'control: the 9-B parent\'s notices loaded').toBeVisible({ timeout: 45000 })
      await expect(notice(op), 'a parent of 9-B does not read 8-A\'s notice').toHaveCount(0)

      expect([...teacher.errors, ...student.errors, ...parent.errors, ...otherParent.errors], 'no uncaught error on any screen').toEqual([])
    } finally {
      await closeAll(teacher, student, parent, otherParent)
    }
  })

  test('a family of two: the mother of 8-A 02 and 11-A 10 sees both children, each in their own class', async ({ browser }) => {
    test.setTimeout(180000)
    let parent: Person | undefined
    try {
      parent = await signIn(browser, 'parent.8a.02@rps.e2e.test', /\/parent/)
      const p = parent.page
      await p.goto('/parent/children', { waitUntil: 'domcontentloaded' })
      await settle(p, 3000)
      const main = p.getByRole('main')
      const child = (name: string) => main.getByRole('button').filter({ hasText: name })
      await expect(child('Vivaan Verma'), 'the younger child').toHaveCount(1, { timeout: 45000 })
      await expect(child('Vivaan Verma')).toContainText('Class 8-A')
      await expect(child('Rudra Verma'), 'the elder child').toHaveCount(1)
      await expect(child('Rudra Verma')).toContainText('Class 11-A')
      await expect(p.getByText('2 linked children').first(), 'the panel counts two children').toBeVisible()

      await child('Rudra Verma').click()
      await expect(main, 'the elder child\'s record').toContainText('Class 11-A · Roll 10', { timeout: 30000 })
      await child('Vivaan Verma').click()
      await expect(main, 'the younger child\'s record').toContainText('Class 8-A · Roll 2', { timeout: 30000 })

      expect(parent.errors, 'no uncaught error').toEqual([])
    } finally {
      await closeAll(parent)
    }
  })
})
