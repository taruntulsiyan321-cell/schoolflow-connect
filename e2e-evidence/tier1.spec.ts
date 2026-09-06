import { test, recordSurface, roleAuthed } from './fixtures'
import { authFile } from './roles'

/**
 * Tier 1 — what a school touches on day one. Each surface records what a user
 * sees (rendered-data / rendered-empty / error) + console + 4xx/5xx + screenshot.
 * Read/render outcomes only; write actions (submit/grade/publish) are recorded
 * as not-exercised this pass to avoid mutating the shared demo DB.
 */

function group(role: string, surfaces: { name: string; url: string }[]) {
  test.describe(`Tier1 · ${role}`, () => {
    test.use({ storageState: authFile(role) })
    test.beforeEach(() => test.skip(!roleAuthed(role), `${role} session not available`))
    for (const s of surfaces) {
      test(s.name, async ({ page, signals }, testInfo) => {
        await recordSurface(page, signals, testInfo, s.name, s.url)
      })
    }
  })
}

group('teacher', [
  { name: 'T1 teacher · dashboard', url: '/teacher' },
  { name: 'T1 teacher · mark attendance', url: '/teacher/attendance' },
  { name: 'T1 teacher · homework (assign/grade)', url: '/teacher/homework' },
  { name: 'T1 teacher · exam marks (enter/publish)', url: '/teacher/exams' },
])

group('student', [
  { name: 'T1 student · attendance', url: '/student/attendance' },
  { name: 'T1 student · homework (view/submit)', url: '/student/homework' },
  { name: 'T1 student · exam marks', url: '/student/tests' },
])

group('parent', [
  { name: 'T1 parent · weekly report (dashboard)', url: '/parent' },
  { name: 'T1 parent · exam report', url: '/parent/marks' },
  { name: 'T1 parent · academic insights', url: '/parent/insights' },
])

group('admin', [
  { name: 'T1 admin · link teacher account', url: '/admin/teachers' },
  { name: 'T1 admin · link student account', url: '/admin/students' },
])
