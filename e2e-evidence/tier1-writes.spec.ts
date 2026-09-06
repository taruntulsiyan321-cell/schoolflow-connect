import { test, expect, roleAuthed, type Signals } from './fixtures'
import { authFile } from './roles'
import type { Page, TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Tier 1 WRITES — the five things a school does every day, driven through the
 * browser as a real user.
 *
 * WHY THIS FILE EXISTS. `tier1.spec.ts` records what each Tier 1 surface
 * RENDERS, and says so in its own header: "write actions (submit/grade/publish)
 * are recorded as not-exercised this pass to avoid mutating the shared demo
 * DB". So every Tier 1 surface was green while no Tier 1 write had ever been
 * attempted through the UI. A rendered form is not a working feature — six
 * exams carry `results_published_at` without `publishResults` ever having run,
 * because the seed wrote them directly. These tests exercise the write itself.
 *
 * EACH TEST RESTORES WHAT IT CHANGED, AND ASSERTS THE RESTORE. The demo tenant
 * is the only environment that exists; a test that leaves a class absent has
 * damaged the thing it was meant to protect, and an unverified restore is how a
 * suite silently rots the data it runs on. Homework is archived again, the
 * evidence exam is deleted, and both restores are asserted with a positive
 * control so a cleanup that silently matched nothing fails instead of passing.
 *
 * ATTENDANCE IS THE ONE EXCEPTION, AND IT IS DELIBERATE. §10.5 makes a day
 * one-shot: "submitted once. After submission, only admin can edit." A TEACHER
 * therefore cannot undo a submission at all, and this suite runs as the
 * teacher. (The admin route now works — 20260910000000 restored the writer a
 * replay had broken — but there is still no admin attendance screen to reach
 * it from, KNOWN_ISSUES 26.) So this suite does not try: it submits an
 * ALL-PRESENT day, which records nothing false about any student, and on any
 * later run that day it asserts the §10.5 refusal instead of writing again.
 * An earlier version marked one student absent and failed to put them back,
 * leaving a real demo student wrongly absent — that is what this shape exists
 * to prevent.
 *
 * ASSERT DURABLE STATE, NOT TRANSIENT TOAST. The "Attendance saved" flash
 * clears itself after 2.8s (TeacherAttendancePage `showFlash`). Waiting on it
 * is a race; the badge driven by `saveState` is the durable signal and is what
 * these tests wait for.
 */

/** The app settles its Supabase reads client-side; give them room. */
async function settle(page: Page, ms = 2000) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

/** Turns a silent UI stall into a report naming the failing request. */
function dump(signals: Signals, testInfo: TestInfo, label: string) {
  const evidence = {
    label,
    consoleErrors: signals.consoleErrors.slice(0, 10),
    pageErrors: signals.pageErrors.slice(0, 10),
    badResponses: signals.badResponses.slice(0, 15),
  }
  testInfo.annotations.push({ type: 'write-evidence', description: JSON.stringify(evidence) })
  return JSON.stringify(evidence)
}

async function bodyText(page: Page): Promise<string> {
  return (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')) || ''
}

/**
 * Archive every homework this suite has ever created, through the app's own
 * Archive action. Called before AND after the chain: "after" keeps a passing
 * run clean, "before" collects what a run that failed half way could not.
 * The Archive button is only rendered while status !== 'archived', so the loop
 * terminates on its own rather than on a counter.
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

/**
 * Sweep this suite's exams as the TEACHER, over the same REST surface the app
 * uses, relying on the permission `exams_delete` already grants the class
 * teacher.
 *
 * This is the FALLBACK, not the main path. The exam test deletes through the
 * Delete control on the exam card; this exists only to collect what a run that
 * died before reaching that click left behind, which by definition never got a
 * chance to use the button. Returns the number deleted.
 */
async function deleteEvidenceExams(page: Page, prefix = 'E2E exam'): Promise<number> {
  const url = envVal('VITE_SUPABASE_URL')
  const anon = envVal('VITE_SUPABASE_PUBLISHABLE_KEY')
  const token = await accessToken(page)
  const H = { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  const q = encodeURIComponent(prefix + '*')
  const list = await page.request.get(url + '/rest/v1/exams?select=id&name=like.' + q, { headers: H })
  let ids: string[] = []
  try { ids = JSON.parse(await list.text()).map((r: { id: string }) => r.id) } catch { ids = [] }
  let deleted = 0
  for (const id of ids) {
    const d = await page.request.delete(url + '/rest/v1/exams?id=eq.' + id, { headers: H })
    if (d.status() === 204 || d.status() === 200) deleted++
  }
  return deleted
}

async function archiveEvidenceHomework(teacher: Page, tag = 'E2E homework'): Promise<number> {
  // Wait for the LIST before counting. Without this, "0 cards" means "the tab
  // had not rendered yet" just as readily as "nothing to clean", and the
  // caller's toHaveCount(0) then passes while the tenant keeps every row —
  // a check that cannot fail. The count returned is the positive control.
  await expect(teacher.getByRole('button', { name: 'New Homework' })).toBeVisible({ timeout: 30000 })
  let archived = 0
  for (let i = 0; i < 25; i++) {
    const cards = teacher
      .locator('div.p-4.bg-surface.rounded-2xl')
      .filter({ hasText: tag })
      .filter({ has: teacher.getByRole('button', { name: 'Archive' }) })
    const n = await cards.count()
    if (n === 0) break
    // runHwAction sets `saving`, which disables EVERY card's buttons while one
    // archive is in flight. Wait for the button, then wait for the effect —
    // a fixed sleep here is what made the previous attempt click a disabled
    // control and time out.
    const btn = cards.last().getByRole('button', { name: 'Archive' })
    await expect(btn).toBeEnabled({ timeout: 30000 })
    await btn.click()
    await expect(cards, 'the archived card leaves the un-archived set').toHaveCount(n - 1, {
      timeout: 30000,
    })
    archived++
  }
  return archived
}

test.describe('Tier1-W · teacher · attendance', () => {
  test.use({ storageState: authFile('teacher') })
  test.beforeEach(() => test.skip(!roleAuthed('teacher'), 'teacher session not available'))

  /**
   * §10.5 (docs/locked-decisions.md:203-205): "Whole class entered in a grid,
   * saved as draft, reviewed, then submitted once. After submission, only
   * admin can edit." The database enforces it —
   * `rpc_bulk_upsert_attendance` raises "Attendance for this section on % has
   * already been submitted. Only an admin can change it." — so a day is a
   * one-shot, and this test has to be written for that rather than around it.
   *
   * TWO THINGS THIS DELIBERATELY DOES NOT DO.
   *
   * It does not leave anybody marked absent. An earlier version marked the
   * first student absent, submitted, and then tried to put them back; the
   * restore is an UPDATE, and updates to `attendance` raise 42703 on a stale
   * audit trigger (KNOWN_ISSUES 25), so it left a real demo student wrongly
   * absent with no path in the app to undo it. The marking CONTROLS are still
   * exercised — a student is toggled to Absent and back before saving — but
   * what gets submitted is an all-present day, which is benign and true.
   *
   * It does not skip when the day is already submitted. Skipping would make a
   * green run mean nothing on the second run of any day. The already-submitted
   * branch asserts the rule instead: the teacher is refused, and told why.
   */
  test('marks and submits attendance, or is correctly refused a second time', async ({
    page,
    signals,
  }, testInfo) => {
    test.setTimeout(180000)
    const absentBtns = () => page.getByRole('button', { name: /^(Mark Absent|Absent)$/ })
    const saveBtn = () => page.getByRole('button', { name: /Save Attendance/i })

    await page.goto('/teacher/attendance', { waitUntil: 'domcontentloaded' })
    await settle(page)

    // The class teacher's own class is the only one this teacher may mark
    // (`canMark = selected.isClassTeacher`) and it is first in the list.
    await expect(saveBtn(), 'Save Attendance renders').toBeVisible({ timeout: 20000 })
    await expect(saveBtn(), 'the teacher may mark this class').toBeEnabled({ timeout: 20000 })

    const rosterSize = await absentBtns().count()
    expect(rosterSize, 'the roster has students to mark').toBeGreaterThan(0)

    // The state has to be read from the DURABLE badge, not from the refusal
    // message: that message is only produced by a rejected save, so a test
    // that looks for it on load always takes the submit branch — and then
    // asserts "Attendance submitted" is visible when it was already visible
    // from the earlier submission, which passes while proving nothing.
    // `saveState` renders exactly one of these two before any click.
    const before = await bodyText(page)
    const alreadySubmitted = before.includes('Attendance submitted')
    const isDraft = before.includes('Not submitted yet')
    expect(
      alreadySubmitted !== isDraft,
      `the day reports exactly one save state (submitted=${alreadySubmitted}, draft=${isDraft})`,
    ).toBe(true)

    // ── THE MARKING CONTROLS WORK ──────────────────────────────────────
    // Asserted in both branches, and reverted before anything is saved.
    await absentBtns().first().click()
    await expect(absentBtns().first(), 'a student can be marked Absent').toHaveText('Absent')
    await absentBtns().first().click()
    await expect(absentBtns().first(), '...and put back to Present').toHaveText('Mark Absent')

    if (alreadySubmitted) {
      // ── §10.5: a submitted day is the admin's from here ──────────────
      await absentBtns().first().click()
      await saveBtn().click()
      await expect(
        page.getByText(/has already been submitted\. Only an admin can change it/i),
        'the second submission of the day is refused, and says why',
      ).toBeVisible({ timeout: 45000 })
      testInfo.annotations.push({
        type: 'tier1-write',
        description: 'attendance already submitted today; §10.5 refusal asserted instead',
      })
      return
    }

    // ── THE SUBMIT ─────────────────────────────────────────────────────
    // Reaching here means the badge read "Not submitted yet", so the assertion
    // below is a TRANSITION, not the re-observation of a badge that was
    // already on screen.
    await page.getByRole('button', { name: 'All Present' }).click()
    await expect(saveBtn(), 'save is enabled').toBeEnabled({ timeout: 20000 })
    await saveBtn().click()
    // `saveState` reaches "submitted" only when the write returned AND the
    // roster reloaded clean, so this covers the whole round trip.
    await expect(
      page.getByText('Attendance submitted'),
      `the submit completed — ${dump(signals, testInfo, 'attendance submit')}`,
    ).toBeVisible({ timeout: 45000 })
    expect(
      await bodyText(page),
      'the day no longer reports itself as an unsubmitted draft',
    ).not.toContain('Not submitted yet')

    // ── IT ROUND-TRIPPED TO THE DATABASE ───────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)
    expect(await bodyText(page), 'the day reads as submitted after a reload').toContain(
      'Attendance submitted',
    )
    await expect(
      page.getByRole('button', { name: /^Absent$/ }),
      'nobody was left marked absent by this test',
    ).toHaveCount(0, { timeout: 20000 })
    testInfo.annotations.push({ type: 'tier1-write', description: 'attendance submitted (all present)' })
  })
})

/**
 * The homework chain, in one test because the three writes are one story: a
 * grade with no submission to grade proves nothing, and a submission against a
 * homework the teacher did not just assign is indistinguishable from seed data.
 * Two browser contexts, because the teacher and the student are two people.
 */
test.describe('Tier1-W · homework · assign → submit → grade', () => {
  test('a teacher assigns homework, the student submits it, and the teacher grades it', async ({
    browser,
  }, testInfo) => {
    test.skip(!roleAuthed('teacher') || !roleAuthed('student'), 'teacher+student sessions required')
    test.setTimeout(240000)

    // Unique per run so the assertions cannot match seeded homework.
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const title = `E2E homework ${stamp}`
    const answer = `Submitted by the Tier 1 evidence run ${stamp}`
    const gradeValue = '18'
    const remark = `Graded by the Tier 1 evidence run ${stamp}`

    const teacherCtx = await browser.newContext({ storageState: authFile('teacher') })
    const studentCtx = await browser.newContext({ storageState: authFile('student') })
    const teacher = await teacherCtx.newPage()
    const student = await studentCtx.newPage()

    try {
      // ── 1. TEACHER ASSIGNS ────────────────────────────────────────────
      await teacher.goto('/teacher/classes', { waitUntil: 'domcontentloaded' })
      await settle(teacher)
      await teacher.getByRole('button', { name: 'Homework', exact: true }).click()
      await settle(teacher, 1500)

      // Collect anything a previously-failed run left published.
      await archiveEvidenceHomework(teacher)

      await teacher.getByRole('button', { name: 'New Homework' }).click()
      await teacher.getByPlaceholder('Title *').fill(title)
      await teacher.getByPlaceholder('Instructions').fill('Tier 1 evidence run — assign/submit/grade.')
      await teacher.getByPlaceholder('Max marks').fill('20')
      // Publishing requires a due date; a week out keeps the submission on time.
      const due = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      await teacher.locator('input[type="date"]').first().fill(due)
      await teacher.getByRole('button', { name: 'Publish Immediately' }).click()
      await teacher.getByRole('button', { name: 'Publish', exact: true }).click()

      await expect(
        teacher.getByText(title),
        `the assigned homework appears in the teacher's list — ${title}`,
      ).toBeVisible({ timeout: 45000 })

      // ── 2. STUDENT SUBMITS ────────────────────────────────────────────
      await student.goto('/student/homework', { waitUntil: 'domcontentloaded' })
      await settle(student)
      await expect(
        student.getByText(title),
        'the newly assigned homework reaches the student',
      ).toBeVisible({ timeout: 45000 })

      // The pending card carries the submit composer; scope to that card so a
      // second homework's textarea can never be the one filled.
      // /student/homework renders gurukul/pages/Assignments, NOT the
      // StudentHomeworkPage of the same name: its composer is collapsed behind
      // a "Submit homework" button and only one opens at a time (`activeId`).
      // The card is the innermost div holding both the title and that button —
      // filtering on the title alone lands on the title element itself.
      const card = student
        .locator('div')
        .filter({ hasText: title })
        .filter({ has: student.getByRole('button', { name: 'Submit homework' }) })
        .last()
      await card.getByRole('button', { name: 'Submit homework' }).click()
      await student.getByPlaceholder('Notes (optional if attaching files)').fill(answer)
      await student.getByRole('button', { name: /^Submit$/ }).click()
      await settle(student, 2500)

      // There is no toast on this path — the composer closes and the list
      // reloads. Reload anyway, so what is asserted came back from the
      // database rather than from component state.
      await student.reload({ waitUntil: 'domcontentloaded' })
      await settle(student)

      // The card carries no copy of the submitted note: Assignments renders the
      // homework's instructions, not the student's answer. So the durable
      // evidence is the status flip, and the composer button turning into
      // "Replace submission" — which only exists once a submission does.
      const submittedCard = student
        .locator('div')
        .filter({ hasText: title })
        .filter({ has: student.getByRole('button', { name: 'Replace submission' }) })
        .last()
      await expect(
        submittedCard,
        'the homework reads as Submitted after a reload',
      ).toContainText('Submitted', { timeout: 30000 })

      // ── 3. TEACHER GRADES ─────────────────────────────────────────────
      await teacher.reload({ waitUntil: 'domcontentloaded' })
      await settle(teacher)
      await teacher.getByRole('button', { name: 'Homework', exact: true }).click()
      await settle(teacher, 1500)

      const hwCard = teacher
        .locator('div.p-4.bg-surface.rounded-2xl')
        .filter({ hasText: title })
        .filter({ has: teacher.getByRole('button', { name: 'Submissions' }) })
        .last()
      await hwCard.getByRole('button', { name: 'Submissions' }).click()

      // openReview() awaits listSubmissions() and listClassStudents() AFTER
      // setting reviewHw, so the panel exists before its rows do. Waiting a
      // fixed interval here raced those two reads and intermittently tried to
      // fill a Grade box that had not rendered; wait for the box itself.
      const gradeInput = teacher.getByPlaceholder('Grade').first()
      await expect(
        gradeInput,
        'the review panel loaded the submission to grade',
      ).toBeVisible({ timeout: 45000 })
      await gradeInput.fill(gradeValue)
      await teacher.getByPlaceholder('Remarks').first().fill(remark)
      await teacher.getByRole('button', { name: /^Grade$/ }).first().click()
      await settle(teacher, 2500)

      // ── 4. THE GRADE REACHES THE STUDENT ──────────────────────────────
      await student.reload({ waitUntil: 'domcontentloaded' })
      await settle(student)
      // Scoped to the card: a bare page-wide search for "18" would match the
      // XP counter in the sidebar and pass without the grade existing.
      const gradedCard = student
        .locator('div')
        .filter({ hasText: title })
        .filter({ has: student.getByRole('button', { name: 'Replace submission' }) })
        .last()
      await expect(
        gradedCard,
        'the grade the teacher entered is on the student card',
      ).toContainText(gradeValue, { timeout: 30000 })
      await expect(
        gradedCard,
        "the teacher's remark reaches the student",
      ).toContainText(remark, { timeout: 30000 })

      // ── 5. RESTORE: the demo tenant keeps no evidence homework ────────
      await teacher.reload({ waitUntil: 'domcontentloaded' })
      await settle(teacher)
      await teacher.getByRole('button', { name: 'Homework', exact: true }).click()
      await settle(teacher, 1500)
      const archived = await archiveEvidenceHomework(teacher)
      // POSITIVE CONTROL. The run just created one, so a cleanup that archives
      // nothing means the locator stopped matching, not that nothing was there.
      expect(archived, 'cleanup archived the homework this run created').toBeGreaterThan(0)
      await expect(
        teacher
          .locator('div.p-4.bg-surface.rounded-2xl')
          .filter({ hasText: 'E2E homework' })
          .filter({ has: teacher.getByRole('button', { name: 'Archive' }) }),
        'no evidence homework is left un-archived',
      ).toHaveCount(0, { timeout: 30000 })

      testInfo.annotations.push({ type: 'tier1-write', description: `homework chain ok: ${title}` })
    } finally {
      await teacherCtx.close().catch(() => {})
      await studentCtx.close().catch(() => {})
    }
  })
})

/**
 * Exam marks: enter, finalise, publish.
 *
 * This is the path that produces `examination.scheduled` and
 * `marks.results_published`. Both event types had ZERO rows in
 * `academic_events` while six exams already carried `results_published_at` —
 * the seed wrote that column directly and `publishResults` had never run,
 * because two separate defects made the path unreachable:
 *
 *   · `exams_read` resolved through `my_visible_exam_ids()`, which selects
 *     from `public.exams`. A STABLE function cannot see the row its own
 *     statement is inserting, so `INSERT ... RETURNING` — what PostgREST
 *     issues for `.insert(...).select()` — was refused 42501 and NO exam could
 *     be created at all.                              (20260909000000)
 *   · `setExamLocked` and `setExamResultsPublished` both write
 *     `exams.updated_at`, a column that did not exist. PGRST204 surfaced as
 *     "This feature isn't available right now." on finalise and on publish.
 *                                                     (20260909010000)
 *
 * Both emitters are `emitEvent(...).catch(() => undefined)`, so a publish
 * whose event failed would still report success to the teacher. Asserting the
 * UI said "published" is therefore NOT the same as asserting the event fired;
 * the event rows are checked separately against `academic_events`.
 */
test.describe('Tier1-W · teacher · exam marks', () => {
  test.use({ storageState: authFile('teacher') })
  test.beforeEach(() => test.skip(!roleAuthed('teacher'), 'teacher session not available'))

  test('creates a class exam, enters marks, finalises and publishes results', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300000)
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const examName = `E2E exam ${stamp}`
    const mark = '42'

    // Exam cards render as div.p-3.bg-surface.rounded-xl (LiveClassPanels).
    const examCard = () =>
      page.locator('div.p-3.bg-surface.rounded-xl').filter({ hasText: examName }).last()

    /** Open the Exams & Marks tab from a fresh page load. */
    const openExamsTab = async () => {
      await page.goto('/teacher/classes', { waitUntil: 'domcontentloaded' })
      await settle(page)
      await page.getByRole('button', { name: 'Exams & Marks', exact: true }).click()
      await settle(page, 1500)
      await expect(
        page.getByRole('button', { name: 'New class exam' }),
        'the exam list is showing',
      ).toBeVisible({ timeout: 30000 })
    }

    await openExamsTab()

    // ── 1. CREATE THE SITTING → examination.scheduled ──────────────────
    await page.getByRole('button', { name: 'New class exam' }).click()
    await page.getByPlaceholder('Exam name * e.g. Unit Test 1').fill(examName)
    const today = new Date().toISOString().slice(0, 10)
    await page.locator('input[type="date"]').first().fill(today)
    await page.getByRole('button', { name: 'Create exam' }).click()
    await expect(examCard(), 'the new sitting appears in the exam list').toBeVisible({
      timeout: 45000,
    })

    // ── 2. ENTER MARKS ─────────────────────────────────────────────────
    await examCard().getByRole('button', { name: /marks$/ }).first().click()
    await settle(page, 1500)
    const marksInputs = page.locator('input[type="number"]')
    await expect(marksInputs.first(), 'the marks roster loaded').toBeVisible({ timeout: 30000 })
    await marksInputs.first().fill(mark)
    await page.getByRole('button', { name: 'Save marks' }).click()
    await expect(page.getByText('Marks saved'), 'the marks write returned').toBeVisible({
      timeout: 45000,
    })

    // ── 3. FINALISE ────────────────────────────────────────────────────
    // Reload rather than clicking "Back to exams": saveMarks() awaits reload()
    // and getExam() AFTER showing its flash and then calls setActiveSubject,
    // so a click in that window is undone and the marks sheet re-mounts. A
    // fresh load also guarantees the list is not serving a pre-finalise row.
    await openExamsTab()
    await examCard().getByRole('button', { name: 'Review / publish' }).click()
    await settle(page, 1500)

    const finalize = page.getByRole('button', { name: 'Finalize all subjects' })
    await expect(finalize, 'finalise is offered to the class teacher').toBeEnabled({ timeout: 30000 })
    await finalize.click()
    await expect(
      page.getByText('Exam finalized — marks locked'),
      'the sitting locked',
    ).toBeVisible({ timeout: 45000 })

    // ── 4. PUBLISH → marks.results_published ───────────────────────────
    // Same reason: finalizeSitting's own reload() races the next click, and a
    // stale row re-opens the sitting with marksLocked=false, which disables
    // Publish. Measured: the lock HAD landed in the database each time.
    await openExamsTab()
    await examCard().getByRole('button', { name: 'Review / publish' }).click()
    await settle(page, 1500)
    const publish = page.getByRole('button', { name: 'Publish Results' })
    await expect(publish, 'publish is enabled once marks are locked').toBeEnabled({ timeout: 30000 })
    await publish.click()
    await expect(
      page.getByText('Results published to students & parents'),
      'publishResults returned without error',
    ).toBeVisible({ timeout: 45000 })

    // ── 5. DURABLE STATE ───────────────────────────────────────────────
    await openExamsTab()
    await expect(examCard(), 'the sitting reads as Published after a reload').toContainText(
      'Published',
      { timeout: 30000 },
    )

    testInfo.annotations.push({ type: 'tier1-write', description: `exam published: ${examName}` })

    // ── 6. RESTORE, THROUGH THE UI ─────────────────────────────────────
    // The Delete control on the exam card calls `MarksService.removeExam`,
    // which existed with the right guard and had ZERO callers in src/ until it
    // was wired up. Cleaning up through it means this suite leaves by the same
    // door a teacher does, instead of reaching past the app over REST.
    //
    // Playwright dismisses dialogs by default, so the confirm has to be
    // accepted BEFORE the click or the delete silently does nothing.
    page.once('dialog', (d) => void d.accept())
    await examCard().getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Exam deleted'), 'the delete returned').toBeVisible({
      timeout: 45000,
    })

    await openExamsTab()
    await expect(examCard(), 'the sitting is gone from the list').toHaveCount(0, { timeout: 30000 })

    // A run that died before this point cannot have used the button, so sweep
    // any leftovers over REST. Reported rather than asserted: a stray means an
    // EARLIER run failed, and failing this one for it would blame the wrong run.
    const strays = await deleteEvidenceExams(page)
    if (strays > 0) {
      testInfo.annotations.push({
        type: 'cleanup',
        description: `${strays} stray evidence exam(s) from an earlier failed run removed over REST`,
      })
    }
  })
})

/**
 * Admin links a teacher account and a student account.
 *
 * Both are re-links to the account each record ALREADY holds. That is
 * deliberate, not a weaker test:
 *
 *   · The teacher path goes through the `admin-link-account` edge function,
 *     which CREATES an auth user when the identifier has none. Pointing it at
 *     a made-up address would mint a real account in the only tenant that
 *     exists, and nothing in the app can delete it again.
 *   · `grantMembership` upserts on (account_id, school_id, role) and the
 *     teachers/students update sets the same user_id, so a re-link is a no-op
 *     in effect while still executing every step: the caller's admin check,
 *     the tenant check, the auth-user lookup, the row update and the
 *     membership grant.
 *
 * The admin check is the part that was historically broken: the function calls
 * `has_role` through a SERVICE-ROLE client, which carries no session, so the
 * two-argument form answered false for every admin and returned 403 "Admin
 * only". The three-argument school-scoped form fixed it. This test is what
 * proves the fix is live in the DEPLOYED function rather than only in the repo.
 */
test.describe('Tier1-W · admin · account linking', () => {
  test.use({ storageState: authFile('admin') })
  test.beforeEach(() => test.skip(!roleAuthed('admin'), 'admin session not available'))

  /** Search the list down to one row, then open that row's edit dialog. */
  async function openRowEditor(page: Page, url: string, searchPlaceholder: string, name: string) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.getByPlaceholder(searchPlaceholder).fill(name)
    await settle(page, 1200)
    const row = page.locator('div.shadow-card').filter({ hasText: name })
    await expect(row, `exactly one row for ${name}`).toHaveCount(1, { timeout: 20000 })
    // The edit control is an icon-only Button; it is the first button in the
    // row's action group, ahead of delete.
    await row.locator('button').first().click()
    await expect(
      page.getByText('Account Access'),
      'the Account Access panel opened',
    ).toBeVisible({ timeout: 20000 })
  }

  test('links a teacher account through the admin-link-account edge function', async ({ page }, testInfo) => {
    test.setTimeout(180000)
    await openRowEditor(page, '/admin/teachers', 'Search by name or subject…', 'Priya Sharma')

    // The Account Access panel is the only bg-gradient-soft block in the
    // dialog. Inside it the first input is the identifier and the first button
    // is the link action (the Switch and Disconnect come after it in the DOM).
    const panel = page.locator('div.bg-gradient-soft')
    await panel.locator('input').first().fill('priya.sharma@wisdomcampus.com')
    await panel.locator('button').first().click()

    await expect(
      page.getByText('Account linked — teacher can now sign in'),
      'the edge function accepted the admin — a 403 here is the has_role/2 defect',
    ).toBeVisible({ timeout: 60000 })
    // A failure surfaces as a toast too, so assert the failure text is absent
    // rather than trusting that one toast implies the other did not appear.
    // Matched narrowly on the actual failure strings: a generic /admin only/i
    // also matches the "Salary (admin only)" FIELD LABEL in this same dialog,
    // which made this assertion fail on a run where the link had succeeded.
    // supabase-js reports a non-2xx from an edge function as
    // "Edge Function returned a non-2xx status code", so that is the string a
    // 403 "Admin only" actually surfaces as here.
    await expect(
      page.getByText(/Could not link account|Edge Function returned a non-2xx/i),
      'no linking error was raised',
    ).toHaveCount(0)
    testInfo.annotations.push({ type: 'tier1-write', description: 'teacher account linked' })
  })

  test('links a student account through admin_connect_student_account', async ({ page }, testInfo) => {
    test.setTimeout(180000)
    await openRowEditor(page, '/admin/students', 'Search by name or admission number…', 'QA Automation')

    const panel = page.locator('div.bg-gradient-soft')
    await panel.getByPlaceholder('Google email or mobile').fill('qa.automation@wisdomcampus.com')
    await panel.getByRole('button', { name: /Link account/ }).click()

    // The RPC returns the uid when an auth user exists (this one does), so the
    // "linked" toast is the expected branch; the "login saved" branch would
    // mean the account was not found, which for a seeded student is a defect.
    await expect(
      page.getByText('Account linked — user can sign in now'),
      'the student was linked to an existing auth account',
    ).toBeVisible({ timeout: 60000 })
    testInfo.annotations.push({ type: 'tier1-write', description: 'student account linked' })
  })
})
