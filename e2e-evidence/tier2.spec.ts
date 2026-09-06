import { test, recordSurface, roleAuthed } from './fixtures'
import { authFile } from './roles'

/**
 * Tier 2 — the learning engine (student). Known context: the AI path has
 * recorded nothing since 2026-08-25 and ai-gateway is undeployed, so practice /
 * revision / recovery / analysis / doubts / coach may fail at the same place.
 * Each surface is recorded SEPARATELY anyway — a shared root cause is a
 * conclusion for the reviewer, not an observation to pre-judge here.
 */
test.describe('Tier2 · student', () => {
  test.use({ storageState: authFile('student') })
  test.beforeEach(() => test.skip(!roleAuthed('student'), 'student session not available'))

  const surfaces = [
    { name: 'T2 student · practice', url: '/student/practice' },
    { name: 'T2 student · revision', url: '/student/revision' },
    { name: 'T2 student · analysis', url: '/student/analysis' },
    { name: 'T2 student · recovery', url: '/student/recovery' },
    { name: 'T2 student · doubt portal', url: '/student/doubts' },
    { name: 'T2 student · AI coach', url: '/student/aicoach' },
    { name: 'T2 student · mistake book', url: '/student/mistakes' },
    { name: 'T2 student · achievements', url: '/student/achievements' },
    { name: 'T2 student · leaderboard', url: '/student/leaderboard' },
    { name: 'T2 student · battleground', url: '/student/battleground' },
  ]

  for (const s of surfaces) {
    test(s.name, async ({ page, signals }, testInfo) => {
      await recordSurface(page, signals, testInfo, s.name, s.url)
    })
  }
})
