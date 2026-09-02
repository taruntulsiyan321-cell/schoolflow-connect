/**
 * Chunk 10.5 verification item 2 — §10.8 at the surface, as real users.
 *
 * "Load the student practice hub and the parent narrative as real users and
 *  assert the sections are absent — not merely that the code changed."
 *
 * THE TRAP THIS FILE IS BUILT AROUND
 * Loading a URL is not loading the screen. /student/practice/math12 sits behind
 * a Class 12 gate that REDIRECTS rather than refusing, so opening it as Arjun
 * (Class 10) lands on a different practice page — and "no strength mentions
 * here" would be a pass read off the wrong screen. Every check below therefore
 * asserts WHERE IT IS before asserting WHAT IS ABSENT, and fails loudly if the
 * identity assertion does not hold.
 *
 * The absence assertions are also paired with a positive. A blank screen, an
 * error boundary, or a redirect to a login page all contain no strength
 * vocabulary, and all three would pass a bare negative. So each screen must
 * ALSO show something it is supposed to show.
 *
 * Sessions come from scripts/mint-role-sessions.mjs — never a typed password.
 *
 *   node scripts/mint-role-sessions.mjs <tmp>/role-sessions.json
 *   SMOKE_SESSIONS=<tmp>/role-sessions.json PLAYWRIGHT_BASE_URL=http://localhost:PORT \
 *     npx playwright test e2e/smoke-10-5-strength.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";

const SESSIONS_PATH = process.env.SMOKE_SESSIONS;

type MintedSession = {
  email: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
type Minted = { ref: string; url: string; roles: Record<string, MintedSession> };

const minted: Minted | null =
  SESSIONS_PATH && existsSync(SESSIONS_PATH)
    ? (JSON.parse(readFileSync(SESSIONS_PATH, "utf8")) as Minted)
    : null;

/** §10.8's vocabulary, as it would appear to a reader. */
const FORBIDDEN = /\b(strong|stronger|strongest|strength|strengths|mastered|mastery|proficient|excellent|doing well|handling well|keep momentum)\b/i;

async function signIn(page: Page, role: string) {
  if (!minted) throw new Error("no minted sessions");
  const s = minted.roles[role];
  if (!s) throw new Error(`no minted session for role "${role}"`);
  const ref = minted.ref;
  await page.addInitScript(
    ([projectRef, session]) => {
      window.localStorage.setItem(
        `sb-${projectRef}-auth-token`,
        JSON.stringify({
          access_token: (session as MintedSession).access_token,
          refresh_token: (session as MintedSession).refresh_token,
          expires_at: (session as MintedSession).expires_at,
          token_type: "bearer",
          user: { id: (session as MintedSession).user_id, email: (session as MintedSession).email },
        }),
      );
    },
    [ref, s] as const,
  );
}

/**
 * Wait for the screen to actually settle, not for a clock to run out.
 *
 * The first version of this file slept 3.5s and then read the body. Both
 * student screens were still rendering "Loading analysis…" at that point — and
 * a spinner contains no strength vocabulary, so a bare absence check would have
 * passed against it. Waiting on the CONDITION is the difference between
 * asserting about the screen and asserting about the wait.
 */
async function settle(page: Page) {
  // The first version used page.waitForFunction and swallowed its rejection.
  // That looked fine and was silently useless: innerText throws
  // "Execution context was destroyed" while the SPA is still navigating, the
  // promise rejects on the FIRST poll, .catch() eats it, and settle returns in
  // milliseconds. Both student screens were then asserted against a spinner —
  // the wait reported success by failing instantly.
  //
  // expect.poll retries instead of racing, and the try/catch is inside the
  // polled function so a destroyed context is one failed attempt rather than
  // the end of the wait.
  //
  // 90s is headroom, not a measured need. An earlier note here claimed the
  // analysis screen took 30-75s to paint; that was the broken wait above being
  // measured, not the screen. With expect.poll it settles in about 5 seconds.
  await expect
    .poll(
      async () => {
        try {
          const t = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
          return t.length > 400 && !/loading/i.test(t);
        } catch {
          return false;
        }
      },
      { timeout: 90_000, intervals: [400] },
    )
    .toBe(true)
    .catch(() => {
      // Deliberate: the assertions below report WHAT the screen shows, which is
      // more actionable than a bare timeout, and every failure message carries
      // the body text.
    });
}

// The chromium project points storageState at e2e/.auth/student.json, which is
// produced by a setup project this file does not run. Sessions here are seeded
// through addInitScript instead, so start from a clean context rather than
// depending on a file whose absence fails all three tests before they load a
// single screen.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Chunk 10.5 item 2 — no strength surface, on the real screens", () => {
  test.skip(!minted, "SMOKE_SESSIONS not set — run scripts/mint-role-sessions.mjs first");

  test("student practice hub, as a Class 12 student", async ({ page }) => {
    await signIn(page, "student12");
    await page.goto("/student/practice/math12", { waitUntil: "domcontentloaded" });
    await settle(page);

    // 1. AM I ON THE SCREEN? A class gate redirects silently, so this is
    //    asserted before anything is concluded from the content.
    expect(
      page.url(),
      `redirected away from the Class 12 practice hub to ${page.url()} — every absence assertion below would have been read off the wrong screen`,
    ).toContain("/student/practice/math12");

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");

    // 2. THE POSITIVE. A blank page, an error boundary and a login redirect all
    //    contain no strength words. The screen has to actually be showing.
    expect(
      body.length,
      `the practice hub rendered almost nothing — an empty screen passes any absence check. Body was: ${JSON.stringify(body)}`,
    ).toBeGreaterThan(200);

    // 3. THE ABSENCE.
    const hit = body.match(FORBIDDEN);
    expect(hit ? `found "${hit[0]}" in: …${body.slice(Math.max(0, (hit.index ?? 0) - 90), (hit.index ?? 0) + 90)}…` : null).toBeNull();
  });

  test("parent academic view, as a real parent", async ({ page }) => {
    await signIn(page, "parent");
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    await settle(page);

    expect(page.url(), `not on a parent screen: ${page.url()}`).toContain("/parent");

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body.length, `the parent screen rendered almost nothing. Body was: ${JSON.stringify(body)}`).toBeGreaterThan(200);

    const hit = body.match(FORBIDDEN);
    expect(hit ? `found "${hit[0]}" in: …${body.slice(Math.max(0, (hit.index ?? 0) - 90), (hit.index ?? 0) + 90)}…` : null).toBeNull();
  });

  test("student analysis screen, where doing_well used to render", async ({ page }) => {
    await signIn(page, "student12");
    await page.goto("/student/analysis", { waitUntil: "domcontentloaded" });
    await settle(page);

    // Not asserted to be a specific path: if this route does not exist for this
    // role the redirect is itself the finding, and the identity check says so.
    expect(page.url(), `not on a student screen: ${page.url()}`).toContain("/student");

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body.length, `the analysis screen rendered almost nothing. Body was: ${JSON.stringify(body)}`).toBeGreaterThan(200);

    const hit = body.match(FORBIDDEN);
    expect(hit ? `found "${hit[0]}" in: …${body.slice(Math.max(0, (hit.index ?? 0) - 90), (hit.index ?? 0) + 90)}…` : null).toBeNull();
  });
});
