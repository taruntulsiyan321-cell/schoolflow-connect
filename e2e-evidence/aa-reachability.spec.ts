import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'

/**
 * REACHABILITY PREFLIGHT — runs before every other spec, and exists to answer
 * one question at a glance: **is the app broken, or is the network down?**
 *
 * WHY IT EXISTS. On 2026-09-07 this machine lost its route to
 * `*.supabase.co`. What the suite showed was not "connection refused": it was
 * `tier1-writes` taking **2 hours** instead of 2 minutes, the app sitting on
 * "Restoring your session…", and sign-in stuck on "Signing in…". Every one of
 * those reads like a product regression. An hour went into diagnosing the
 * wrong cause — and a `DELETE` on `auth.sessions` was run on the strength of
 * it — before a direct probe showed the truth:
 *
 *     connect ETIMEDOUT 104.18.38.10:443    on auth AND rest AND health
 *
 * A TCP connect timeout on every endpoint is not something the application can
 * cause. This spec makes that visible in ten seconds instead of two hours.
 *
 * It is FIRST alphabetically on purpose, so its failure is the first line of
 * the report rather than the hundredth.
 *
 * It asserts rather than logs. A diagnostic that always passes is a check that
 * cannot fail; this one goes red exactly when the network is the problem, and
 * when it is red every failure under it should be read as unproven, not as a
 * regression.
 */

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

test('Supabase is reachable from this machine', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const url = envVal('VITE_SUPABASE_URL')
  const anon = envVal('VITE_SUPABASE_PUBLISHABLE_KEY')
  await page.goto('/auth', { waitUntil: 'domcontentloaded' })

  const probe = async (name: string, path: string) => {
    const started = Date.now()
    try {
      const res = await page.request.get(url + path, {
        headers: { apikey: anon },
        timeout: 30000,
      })
      return { name, ms: Date.now() - started, status: res.status(), threw: '' }
    } catch (e) {
      return {
        name, ms: Date.now() - started, status: 0,
        threw: String((e as Error).message).split('\n')[0].slice(0, 120),
      }
    }
  }

  // Both services, because "auth is down" and "the host is unreachable" are
  // different problems with different answers.
  const auth = await probe('auth', '/auth/v1/health')
  const rest = await probe('rest', '/rest/v1/schools?select=id&limit=1')
  testInfo.annotations.push({
    type: 'reachability',
    description: JSON.stringify({ auth, rest }),
  })

  expect(
    auth.threw,
    `GoTrue is unreachable (${auth.ms}ms). Every auth-dependent failure below is UNPROVEN, not a regression.`,
  ).toBe('')
  expect(
    rest.threw,
    `PostgREST is unreachable (${rest.ms}ms). Every failure below is UNPROVEN, not a regression.`,
  ).toBe('')
  // A 4xx is a live service answering; only 5xx and a dead connection matter here.
  expect(auth.status, 'GoTrue answered 5xx').toBeLessThan(500)
  expect(rest.status, 'PostgREST answered 5xx').toBeLessThan(500)
})
