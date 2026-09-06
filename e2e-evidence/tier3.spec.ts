import { test, recordSurface, roleAuthed } from './fixtures'
import { authFile } from './roles'

/**
 * Tier 3 — reporting. Principal data surfaces + exam reports; teacher exam
 * reports; admin report generation. The ephemeral test report does not exist
 * (no table/generation/expiry) and is deliberately NOT tested. Exam reports are
 * a different feature and are covered.
 */

function group(role: string, surfaces: { name: string; url: string }[]) {
  test.describe(`Tier3 · ${role}`, () => {
    test.use({ storageState: authFile(role) })
    test.beforeEach(() => test.skip(!roleAuthed(role), `${role} session not available`))
    for (const s of surfaces) {
      test(s.name, async ({ page, signals }, testInfo) => {
        await recordSurface(page, signals, testInfo, s.name, s.url)
      })
    }
  })
}

group('principal', [
  { name: 'T3 principal · dashboard', url: '/principal' },
  { name: 'T3 principal · analytics', url: '/principal/analytics' },
  { name: 'T3 principal · attendance', url: '/principal/attendance' },
  { name: 'T3 principal · exam reports', url: '/principal/exams' },
  { name: 'T3 principal · classes', url: '/principal/classes' },
  { name: 'T3 principal · students', url: '/principal/students' },
  { name: 'T3 principal · teachers', url: '/principal/teachers' },
])

group('teacher', [
  { name: 'T3 teacher · exam reports', url: '/teacher/exams' },
])

group('admin', [
  { name: 'T3 admin · report generation', url: '/admin/reports' },
  { name: 'T3 admin · financial report', url: '/admin/fees' },
])
