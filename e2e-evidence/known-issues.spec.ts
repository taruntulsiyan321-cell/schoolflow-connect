import { test, expect, freshSession } from './fixtures'
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

// ═════════════════════════════════════════════════════════════════════════════
// KNOWN_ISSUES 2 + 14 — one call proves both, because they are the same call
//
//   2. `dpp-generate-questions` gated on ["teacher","admin","principal"], so
//      the two STUDENT callers of `aiPracticeQuestions.ts` (Class12AiSession,
//      mistakeRecovery — both live student routes) were refused by design. The
//      ruling was made on 2026-09-04: students should reach it.
//
//  14. The 2 units are reserved BEFORE the provider is called and were never
//      returned. A failed generation charged the school for nothing.
//
// A student-triggered run bills `student.dpp.generate_questions`, a feature_id
// that did not exist before this change — so the row's mere existence proves
// the gate admitted a student, and its `units_used` proves what happened to the
// reservation afterwards. Two contexts are needed because only an admin or
// principal of the school may read `ai_budget_usage`.
// ═════════════════════════════════════════════════════════════════════════════
test.describe('KNOWN_ISSUES 2 + 14 — a student reaches generation, and the units are accounted for', () => {
  test('a student is admitted, billed on their own line, and refunded if it fails', async ({ browser }, testInfo) => {
    test.setTimeout(240000)
    const url = envVal('VITE_SUPABASE_URL')
    const FEATURE = 'student.dpp.generate_questions'
    const day = new Date().toISOString().slice(0, 10)   // the function keys on UTC

    // Own session, same reason as the student below: `admin` is also loaded from
    // the shared file by tier1, tier1-writes and tier3.
    const adminPage = await freshSession(browser, 'admin')
    await adminPage.goto('/admin', { waitUntil: 'domcontentloaded' })
    await settle(adminPage)
    const adminH = await restHeaders(adminPage)

    /** The student feature line for today, as the admin. null when no row yet. */
    const readUnits = async (): Promise<number | null> => {
      const res = await adminPage.request.get(
        url + '/rest/v1/ai_budget_usage?select=units_used&period=eq.daily'
          + '&period_key=eq.' + day + '&feature_id=eq.' + encodeURIComponent(FEATURE),
        { headers: adminH },
      )
      const rows = JSON.parse(await res.text()) as Array<{ units_used: number }>
      return rows.length > 0 ? Number(rows[0].units_used) : null
    }
    const before = await readUnits()

    // Its OWN session, not the shared `.auth/student.json` one. Two contexts
    // loading the same stored Supabase session look like refresh-token reuse,
    // and Supabase revokes the whole session family when it sees that — which
    // took 13 student surfaces red across tier1 and tier2 in one run while the
    // same specs passed alone. `freshSession` signs in through the real form.
    const studentPage = await freshSession(browser, 'student')
    await studentPage.goto('/student', { waitUntil: 'domcontentloaded' })
    await settle(studentPage)
    const studentToken = await accessToken(studentPage)

    // count:1 deliberately — the README asks that the first live run be small.
    const res = await studentPage.request.post(url + '/functions/v1/dpp-generate-questions', {
      headers: {
        apikey: envVal('VITE_SUPABASE_PUBLISHABLE_KEY'),
        Authorization: 'Bearer ' + studentToken,
        'Content-Type': 'application/json',
      },
      data: { subject: 'Mathematics', topic: 'fractions', count: 1, difficulty: 'easy' },
      timeout: 120000,
    })
    const status = res.status()
    const body = await res.text()
    testInfo.annotations.push({ type: 'dpp-response', description: status + ' ' + body.slice(0, 400) })

    // ── ISSUE 2: the gate. Neither refusal may appear again. ────────────────
    expect(status, 'a student was refused outright: ' + body).not.toBe(403)
    expect(body).not.toContain('insufficient_role')
    expect(body).not.toContain('No school context for caller')

    const after = await readUnits()

    // ── ISSUE 2, the billing line. It exists only because a student ran. ────
    expect(after, 'no ' + FEATURE + ' usage row — the student never reached the reservation').not.toBeNull()

    // ── ISSUE 14: what happened to the 2 units. ─────────────────────────────
    // Both branches make a definite claim; neither can pass by accident.
    const succeeded = status >= 200 && status < 300 && !/"error"/.test(body)
    if (succeeded) {
      expect(after, 'a successful generation must CHARGE the 2 units it used')
        .toBe((before ?? 0) + 2)
    } else {
      expect(after, 'a failed generation must give the 2 units back: ' + status + ' ' + body.slice(0, 200))
        .toBe(before ?? 0)
    }

    // ── ISSUE 14, DETERMINISTICALLY ─────────────────────────────────────────
    //
    // The branch above is honest but not reliable: when the provider answers,
    // the success branch runs and the REFUND is never exercised. This second
    // call always takes a failure path — `question_format: "bogus"` is rejected
    // AFTER the reservation and BEFORE the provider, which is precisely the
    // shape KNOWN_ISSUES 14 described: units taken, nothing produced.
    const beforeBad = await readUnits()
    const bad = await studentPage.request.post(url + '/functions/v1/dpp-generate-questions', {
      headers: {
        apikey: envVal('VITE_SUPABASE_PUBLISHABLE_KEY'),
        Authorization: 'Bearer ' + studentToken,
        'Content-Type': 'application/json',
      },
      data: { subject: 'Mathematics', topic: 'fractions', count: 1, question_format: 'bogus' },
      timeout: 60000,
    })
    const badBody = await bad.text()
    testInfo.annotations.push({ type: 'dpp-refund', description: bad.status() + ' ' + badBody.slice(0, 200) })

    // It has to fail for the right reason — a 403 here would mean the units
    // were never reserved and the refund assertion below would prove nothing.
    expect(bad.status(), 'expected the format rejection, got: ' + badBody).toBe(400)
    expect(badBody).toContain('question_format')

    const afterBad = await readUnits()
    expect(afterBad, 'the reservation was not returned after a rejected request')
      .toBe(beforeBad)

    await studentPage.context().close()
    await adminPage.context().close()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// KNOWN_ISSUES 7 — the client half, landed ahead of the fence
//
// The fence itself (make `academic-files` private, scope the read policy to the
// uploader's school) is BLOCKED: this environment's safety classifier refuses
// migrations that rewrite `storage.objects` policies, and it is not retried
// here. What that fence needed first was for the app to stop depending on
// public URLs — rows storing `https://…/object/public/…` would all break the
// instant the bucket turned private.
//
// So uploads now store a durable ref and every read resolves a SIGNED url. That
// works both before and after the fence, which is what makes the fence a
// one-line migration instead of a migration plus a scramble.
//
// This test proves the mechanism against the live bucket and the live policy,
// as a real teacher: upload -> sign -> fetch -> delete. The pure ref/path
// parsing is covered in src/academic/storage/academicFileRef.test.ts.
// ═════════════════════════════════════════════════════════════════════════════
test.describe('KNOWN_ISSUES 7 — the buckets are private and signing still reaches the right people', () => {
  test('upload, sign, fetch, delete — and the public URL is dead', async ({ browser }) => {
    test.setTimeout(180000)
    // Own sessions for both roles: `teacher` and `student` are loaded from the
    // shared files by tier1/tier2, and a second context on those revokes them.
    const page = await freshSession(browser, 'teacher')
    await page.goto('/teacher/resources', { waitUntil: 'domcontentloaded' })
    await settle(page)

    const url = envVal('VITE_SUPABASE_URL')
    const anon = envVal('VITE_SUPABASE_PUBLISHABLE_KEY')
    const token = await accessToken(page)
    const uid = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')).sub as string
    const auth = { apikey: anon, Authorization: 'Bearer ' + token }

    // The path shape `uploadAcademicFile` writes: {auth.uid}/{ts}-{name}.
    // The INSERT policy pins segment 1 to auth.uid(), so any other shape is
    // refused — which also means a passing upload proves the shape is right.
    const objectPath = uid + '/' + Date.now() + '-e2e-signed-url-probe.txt'
    const body = 'evidence for KNOWN_ISSUES 7\n'

    const up = await page.request.post(url + '/storage/v1/object/academic-files/' + objectPath, {
      headers: { ...auth, 'Content-Type': 'text/plain' },
      data: body,
    })
    expect(up.status(), 'upload failed: ' + (await up.text())).toBe(200)

    try {
      // ── The signing the client now does on every read ────────────────────
      const sign = await page.request.post(
        url + '/storage/v1/object/sign/academic-files/' + objectPath,
        { headers: { ...auth, 'Content-Type': 'application/json' }, data: { expiresIn: 3600 } },
      )
      const signBody = await sign.text()
      expect(sign.status(), 'signing failed: ' + signBody).toBe(200)
      const signedURL = (JSON.parse(signBody) as { signedURL: string }).signedURL
      expect(signedURL, 'no signedURL in ' + signBody).toBeTruthy()
      expect(signedURL).toContain('token=')
      // The API returns a path relative to /storage/v1, not an absolute URL —
      // supabase-js prefixes it, and so must this. Without the prefix the GET
      // below resolves against the app's own origin and cheerfully returns the
      // SPA's index.html with status 200: a green assertion measuring nothing.
      const absolute = /^https?:/i.test(signedURL)
        ? signedURL
        : url + '/storage/v1' + (signedURL.startsWith('/') ? '' : '/') + signedURL

      // ── ...and it has to actually FETCH, with no session ─────────────────
      // A signed URL that cannot be downloaded would pass every check above
      // and still leave every attachment broken. This is deliberately sent
      // WITHOUT the Authorization header: the signature is the whole authority,
      // which is what keeps it working now that the bucket is private.
      const fetched = await page.request.get(absolute)
      expect(fetched.status(), 'signed URL did not fetch').toBe(200)
      expect(await fetched.text()).toBe(body)

      // ── THE FENCE: the public URL that used to work must not ─────────────
      // `academic-files` was `public = true`, so this exact path was
      // downloadable by anyone on the internet with no token at all. That is
      // the thing KNOWN_ISSUES 7 was about, and it is the only assertion here
      // that a still-public bucket would fail.
      const publicUrl = url + '/storage/v1/object/public/academic-files/' + objectPath
      const anon = await page.request.get(publicUrl)
      expect(anon.status(), 'the object is STILL downloadable with no token').not.toBe(200)

      // ── A CLASSMATE'S TEACHER'S FILE: the case the first policy broke ────
      // The drafted policy read `public.profiles` from inside the predicate,
      // which runs as the caller — and a student sees exactly one row there,
      // their own. Every academic file uploaded by anyone else was refused.
      // Every DENIAL test still passed; only this one failed.
      const studentPage = await freshSession(browser, 'student')
      await studentPage.goto('/student', { waitUntil: 'domcontentloaded' })
      await settle(studentPage)
      const studentH = await restHeaders(studentPage)
      const studentSign = await studentPage.request.post(
        url + '/storage/v1/object/sign/academic-files/' + objectPath,
        { headers: { ...studentH, 'Content-Type': 'application/json' }, data: { expiresIn: 600 } },
      )
      const studentBody = await studentSign.text()
      expect(studentSign.status(),
        'a same-school student cannot sign the teacher file: ' + studentBody).toBe(200)
      await studentPage.context().close()
    } finally {
      const del = await page.request.delete(
        url + '/storage/v1/object/academic-files/' + objectPath, { headers: auth },
      )
      expect([200, 204]).toContain(del.status())
    }

    // Assert the cleanup: the object must be gone, not merely reported deleted.
    const after = await page.request.post(url + '/storage/v1/object/list/academic-files', {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: { prefix: uid + '/', limit: 100 },
    })
    const names = (JSON.parse(await after.text()) as Array<{ name: string }>).map((o) => o.name)
    expect(names).not.toContain(objectPath.split('/').slice(1).join('/'))

    await page.context().close()
  })
})
