import { test, expect, recordSurface, roleAuthed } from './fixtures'
import { authFile } from './roles'

/**
 * Tier 4 — the two seeded accounts (super_admin + dual teacher-parent) and the
 * MembershipSwitcher switch test. Evidence only.
 */

test.describe('Tier4 · super_admin', () => {
  test.use({ storageState: authFile('super_admin') })
  test.beforeEach(() => test.skip(!roleAuthed('super_admin'), 'super_admin session not available'))
  const surfaces = [
    { name: 'T4 super_admin · admin home', url: '/admin' },
    { name: 'T4 super_admin · students', url: '/admin/students' },
    { name: 'T4 super_admin · settings', url: '/admin/settings' },
  ]
  for (const s of surfaces) {
    test(s.name, async ({ page, signals }, testInfo) => {
      await recordSurface(page, signals, testInfo, s.name, s.url)
    })
  }
})

test.describe('Tier4 · dual teacher-parent', () => {
  test.use({ storageState: authFile('dual_teacher_parent') })
  test.beforeEach(() => test.skip(!roleAuthed('dual_teacher_parent'), 'dual session not available'))

  test('T4 dual · teacher surface (landed role)', async ({ page, signals }, testInfo) => {
    await recordSurface(page, signals, testInfo, 'T4 dual · teacher attendance (landed)', '/teacher/attendance')
  })

  test('T4 dual · parent surface WITHOUT switching', async ({ page, signals }, testInfo) => {
    // Records whether the parent surface is reachable while teacher is the
    // active membership (has_role/2 resolves one active membership at a time).
    await recordSurface(page, signals, testInfo, 'T4 dual · parent marks (pre-switch)', '/parent/marks')
  })

  test('T4 dual · MembershipSwitcher teacher -> parent', async ({ page, signals }, testInfo) => {
    await page.goto('/teacher', { waitUntil: 'domcontentloaded' })
    const sel = page.locator('#membership-switcher')
    await expect(sel, 'membership switcher should render for a 2-membership account').toBeVisible({ timeout: 20000 })

    const parentOption = sel.locator('option', { hasText: 'Parent' }).first()
    const parentVal = await parentOption.getAttribute('value')
    expect(parentVal, 'a Parent option exists in the switcher').toBeTruthy()

    await sel.selectOption(parentVal as string)
    // The component calls rpc_switch_membership + refreshAuth, then navigates.
    // Give the RPC + auth refresh time; record where it auto-lands (the
    // component's own navigation), then prove the other role's surfaces are now
    // reachable — that is the switch's purpose, independent of auto-nav.
    await page.waitForTimeout(5000)
    const autoLanded = page.url()
    testInfo.annotations.push({ type: 'switch-auto-landed', description: autoLanded })

    await recordSurface(page, signals, testInfo, 'T4 dual · after switch -> parent marks', '/parent/marks')
    expect.soft(page.url(), 'parent surface reachable after switch (not /unauthorized)').not.toContain('/unauthorized')
    expect.soft(page.url(), 'parent surface reachable after switch').toContain('/parent')
  })
})
