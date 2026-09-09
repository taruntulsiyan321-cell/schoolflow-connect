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
  // `MyClasses` auto-selects the teacher's first class, so the SUB-TAB BAR is
  // what proves the classes loaded — waiting for it is both simpler and closer
  // to what this file actually asserts.
  //
  // What was here before waited for a `button` whose text began with a digit.
  // The class chip renders its SECTION badge first, so its accessible name is
  // "A 10 A · Mathematics" — that pattern could never match, and all five
  // teacher panel tests timed out on this line rather than on anything they
  // were written to check. Measured 2026-09-09 from the failure snapshot.
  const tabButton = page.getByRole('button', { name: tab }).first()
  await tabButton.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})

  if (!(await tabButton.isVisible())) {
    // No tab bar means no class is selected. Say which of the two reasons that
    // is, rather than timing out on a locator and leaving it ambiguous.
    const chips = page.getByRole('button', { name: /\d+\s*\S*\s*·/ })
    expect(
      await chips.count(),
      'the teacher has at least one assigned class — with none there is no panel to open',
    ).toBeGreaterThan(0)
    await chips.first().click()
    await tabButton.waitFor({ state: 'visible', timeout: 30000 })
  }

  await tabButton.click()
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
    // The composer defaults to MCQ, and `addManualQuestion` refuses one
    // without at least two options AND a correct answer. Filling only the
    // question and the marks — which is what this test used to do — left
    // `questions` empty, so "Next: Review" never advanced and the Publish
    // button this test then waited 20s for was never rendered. The app was
    // right and said so ("MCQ needs at least 2 options"); the test was not.
    await page.getByPlaceholder('Option A').fill('4')
    await page.getByPlaceholder('Option B').fill('5')
    await page.getByPlaceholder('Option C').fill('6')
    await page.getByPlaceholder('Option D').fill('7')
    await page.getByPlaceholder('Correct option text *').fill('5')
    await page.getByPlaceholder('Marks').fill('5')
    await page.getByRole('button', { name: /add question/i }).click()

    // Prove the question actually landed before moving on, so a future
    // validation change fails HERE with a readable reason instead of 20s later
    // on a missing Publish button.
    await expect(
      page.getByText(/total questions:\s*1/i).first(),
      'the composer accepted the question — an empty test cannot be published',
    ).toBeVisible({ timeout: 10000 })

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

  /**
   * §10.25. The class report — a surface that did not exist at all until
   * 20260916000000, and whose fence has already been wrong once: the student
   * half handed out another school's answer key (20260916020000, probe38
   * claims 11-14).
   *
   * probe38 proves the fence in SQL. This proves the round trip: that the
   * teacher's own browser reaches it, and that the RPC does not come back 42501
   * at the one caller that is supposed to be admitted. A 403 here shows up as a
   * supabase bad response, which is exactly what `supaErrors` collects.
   *
   * Runs after the create test above so there is a test in the class to report
   * on. If the class has none it FAILS rather than skips — an unreported
   * surface is what this file exists to stop recording as green.
   */
  test('a teacher opens the class report for a test', async ({ page, signals }, testInfo) => {
    await openClassTab(page, /^Tests$/)

    const reportButtons = page.getByRole('button', { name: /^Report$/ })
    const count = await reportButtons.count()
    expect(
      count,
      'the Tests panel offers a Report control on at least one test — with none, ' +
        '§10.25 is unproven from the browser however green probe38 is',
    ).toBeGreaterThan(0)

    await reportButtons.first().click()
    await page.waitForTimeout(3000)

    const body = await page.evaluate(() => document.body?.innerText ?? '')
    const supa = supaErrors(signals)
    const reportCalls = supa.filter((r) => /rpc_test_(class|student)_report/.test(r.url))
    await evidence(testInfo, 'teacher class report', page, {
      bodySample: body.replace(/\s+/g, ' ').slice(0, 500),
      supabase: supa,
      reportRpcFailures: reportCalls,
    })

    expect(reportCalls, 'the report RPC refused the teacher it is built for').toEqual([])
    expect(body, 'the report reported a failure').not.toMatch(
      /could not load the report|not your class/i,
    )
    await expect(
      page.getByText(/class list/i).first(),
      'the report renders its class list',
    ).toBeVisible({ timeout: 20000 })
    await expect(
      page.getByText(/class average/i).first(),
      'the report renders the class aggregate §10.25 asks for first',
    ).toBeVisible({ timeout: 20000 })
  })

  /**
   * §10.24. The question paper screen — the first UI the three
   * `question_paper*` tables have ever had.
   *
   * probe39 proves the fence and the bank fill in SQL, as the caller. This
   * proves the round trip: the route mounts, a paper is created through
   * PostgREST, and a section fills from the 21,681-question bank without the
   * writes being refused. A 42501 on any of it shows up in `supaErrors`.
   *
   * The subject is taken from the bank's own vocabulary rather than typed:
   * `question_bank.subject` is matched exactly, so "science" would retrieve
   * nothing and the fill would report 0 with no error — a green test proving
   * the opposite of what it claims.
   */
  test('a teacher builds a question paper and fills it from the bank', async ({ page, signals }, testInfo) => {
    await page.goto('/teacher/question-papers', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

    await expect(
      page.getByRole('button', { name: /new paper/i }).first(),
      'the question papers screen mounts with its own control',
    ).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: /new paper/i }).first().click()
    const title = `E2E paper ${Date.now()}`
    await page.getByPlaceholder('Paper title *').fill(title)
    await page.getByPlaceholder('Subject *').fill('Science')
    await page.getByRole('button', { name: /^Create paper$/ }).click()
    await page.waitForTimeout(4000)

    const afterCreate = await page.evaluate(() => document.body?.innerText ?? '')
    const paperWrites = supaErrors(signals).filter((r) => /question_paper/.test(r.url))
    await evidence(testInfo, 'teacher question paper', page, {
      title,
      bodySample: afterCreate.replace(/\s+/g, ' ').slice(0, 400),
      supabase: supaErrors(signals),
      paperTableWrites: paperWrites,
    })

    expect(paperWrites, 'a write to a question_paper table was refused').toEqual([])
    await expect(
      page.getByRole('button', { name: /add section/i }).first(),
      'the new paper opened into its blueprint',
    ).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: /add section/i }).first().click()
    await page.getByPlaceholder('Section title *').fill('Section A')
    await page.getByRole('button', { name: /^Add section$/ }).click()
    await page.waitForTimeout(3000)

    await page.getByRole('button', { name: /fill from bank/i }).first().click()
    await page.waitForTimeout(6000)

    const body = await page.evaluate(() => document.body?.innerText ?? '')
    await evidence(testInfo, 'teacher fills from bank', page, {
      bodySample: body.replace(/\s+/g, ' ').slice(0, 500),
      supabase: supaErrors(signals),
    })

    // The screen always reports what the fill did. "Added 0" is a legitimate
    // outcome the UI must state; what it must never do is stay silent.
    await expect(
      page.getByText(/Added .* from .* matching in the bank/i).first(),
      'the fill reports what it added and what it could not',
    ).toBeVisible({ timeout: 20000 })
    expect(
      supaErrors(signals).filter((r) => /rpc_fill_paper_section_from_bank/.test(r.url)),
      'the bank fill RPC refused the teacher it is built for',
    ).toEqual([])
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

    // The attempt screen mounts as "Loading Test…" and then fetches the paper.
    // A fixed 3s wait raced that and read the loading placeholder as the final
    // render, so this failed on "a question is on screen" while the app was
    // merely still loading. Wait for the placeholder to go: a refusal clears it
    // too, so the two assertions below still get their say.
    await page
      .waitForFunction(() => !/Loading Test/i.test(document.body?.innerText ?? ''), undefined, {
        timeout: 30000,
      })
      .catch(() => {})

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
    //
    // `QuestionRenderer` draws each choice as a <button> carrying an A/B/C/D
    // badge — there is no radio or checkbox anywhere on the attempt screen. The
    // old `input[type=radio], input[type=checkbox]` selector therefore matched
    // nothing and silently fell through, and this test submitted a paper with
    // "0/1 answered" while claiming to have answered it.
    // THE CONTROL. Nothing is answered yet, and the counter is on screen to say
    // so. Without this, the assertion after the click would also pass on a page
    // that had said "1/1 answered" all along, and the regression below would be
    // invisible.
    await expect(
      page.getByText(/\b0\s*\/\s*\d+\s+answered/i).first(),
      'control: the counter is present and reads zero before the click',
    ).toBeVisible({ timeout: 20000 })

    const choice = page.getByRole('button', { name: /^[A-D]\s/ }).first()
    const isMultipleChoice = await choice
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false)
    // `count()` was here, and it races the render: it returns 0 while the
    // question is still painting, so the click was silently skipped and the
    // paper submitted empty. Waiting is the difference between "no options" and
    // "no options YET".
    if (isMultipleChoice) {
      await choice.click()
    } else {
      const textAnswer = page.locator('textarea, input[type="text"], input[type="number"]').first()
      if (await textAnswer.count()) await textAnswer.fill('42')
    }

    // The regression probe for KNOWN_ISSUES 43. The click updates `responses`
    // synchronously, so this half always passed; what failed was the state
    // SURVIVING. Six concurrent `load()` calls raced the click, and the first to
    // resolve replaced the answer with the server's older view — the counter
    // fell back to "0/1 answered" about 250ms later and stayed there.
    await expect(
      page.getByText(/\b[1-9]\d*\s*\/\s*\d+\s+answered/i).first(),
      'the attempt screen recorded the answer',
    ).toBeVisible({ timeout: 10000 })

    // The half that used to fail: still true once every in-flight load settles.
    await page.waitForTimeout(3000)
    await expect(
      page.getByText(/\b[1-9]\d*\s*\/\s*\d+\s+answered/i).first(),
      'the answer survived the loads that resolve after the click (KNOWN_ISSUES 43)',
    ).toBeVisible()

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

    // §10.25's report, on the student's own side. This student has just
    // submitted, so `rpc_test_student_report` must admit them — the fence added
    // in 20260916020000 refuses a test they have NOT sat, and getting that
    // backwards would lock a student out of their own result while looking like
    // a correct denial. The card is the positive control for that fence in the
    // browser.
    await expect(
      page.getByText(/topics to revise/i).first(),
      'the result screen carries the report, not only the score',
    ).toBeVisible({ timeout: 20000 })
    expect(
      resultBody,
      'the report did not refuse the student their own result',
    ).not.toMatch(/not your test report|could not load your topic summary/i)
  })
})
