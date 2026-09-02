/**
 * Chunk 10.6 routing probe — load ONE screen as ONE real role and report.
 *
 *   PROBE_ROLE=student PROBE_URL=/student/mistake-bank \
 *   SMOKE_SESSIONS=<tmp>/role-sessions.json PLAYWRIGHT_BASE_URL=http://localhost:PORT \
 *     npx playwright test e2e/_route-probe.spec.ts --project=chromium
 *
 * WHY THIS EXISTS
 * The operational rule for the 21 is that "working" from a static classification
 * is not working — UpcomingBlock was classified working-should-be-routed and was
 * 4-for-4 on stale identifiers, throwing on every load. So each screen is
 * reclassified by LOADING it, and this reports the four things that decide it:
 *
 *   where it ended up   a role gate redirects silently; the URL after load is
 *                       the only proof the assertion is about this screen
 *   console + network   stale columns and null-guard gaps surface here first
 *   what it rendered    a spinner and an error boundary are both "no errors"
 *   strength vocabulary the §10.8 prose sites get fixed as their screen routes
 *
 * This probe never fails the run. It is an instrument, not a gate — it prints
 * and lets the human decide. The gates are run separately.
 */
import { test } from "@playwright/test";
import { readFileSync, existsSync } from "fs";

const SESSIONS_PATH = process.env.SMOKE_SESSIONS;
const ROLE = process.env.PROBE_ROLE ?? "student";
const URL_PATH = process.env.PROBE_URL ?? "/";

const minted = SESSIONS_PATH && existsSync(SESSIONS_PATH)
  ? JSON.parse(readFileSync(SESSIONS_PATH, "utf8"))
  : null;

const FORBIDDEN = /\b(strong|stronger|strongest|strength|strengths|mastered|mastery|proficient|excellent|doing well|handling well|keep momentum)\b/i;

const IGNORABLE = [
  /\[vite\]/i,
  /favicon/i,
  /Download the React DevTools/i,
  /ERR_CONNECTION_REFUSED.*ws:/i,
  /Failed to load resource.*net::ERR_/i,
];

test.use({ storageState: { cookies: [], origins: [] } });

test(`probe ${ROLE} ${URL_PATH}`, async ({ page }) => {
  test.skip(!minted, "SMOKE_SESSIONS not set");
  const s = minted.roles[ROLE];
  if (!s) throw new Error(`no minted session for "${ROLE}" — have: ${Object.keys(minted.roles).join(", ")}`);

  await page.addInitScript(
    ([ref, sess]: any) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: sess.access_token, refresh_token: sess.refresh_token,
        expires_at: sess.expires_at, token_type: "bearer",
        user: { id: sess.user_id, email: sess.email },
      }));
    },
    [minted.ref, s] as any,
  );

  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!IGNORABLE.some((r) => r.test(t))) problems.push(`console: ${t.slice(0, 220)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e.message).slice(0, 220)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon|\.map$/.test(r.url())) {
      problems.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 150)}`);
    }
  });

  await page.goto(URL_PATH, { waitUntil: "domcontentloaded" });

  // Settle on the condition, never on a clock: a fixed sleep reads the spinner
  // and every "no errors / no strength words" conclusion is drawn from it.
  await expectSettled(page);

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const hit = body.match(FORBIDDEN);

  console.log("──────── PROBE RESULT ────────");
  console.log(`role         ${ROLE}`);
  console.log(`asked for    ${URL_PATH}`);
  console.log(`landed on    ${new URL(page.url()).pathname}${new URL(page.url()).pathname === URL_PATH ? "" : "   <<< REDIRECTED"}`);
  console.log(`body length  ${body.length}${body.length < 250 ? "   <<< RENDERED ALMOST NOTHING" : ""}`);
  console.log(`strength     ${hit ? `<<< "${hit[0]}" — ${body.slice(Math.max(0, (hit.index ?? 0) - 60), (hit.index ?? 0) + 60)}` : "none"}`);
  console.log(`problems     ${problems.length}`);
  for (const p of [...new Set(problems)].slice(0, 10)) console.log(`   ${p}`);
  console.log(`body         ${body.slice(0, 420)}`);
  console.log("──────────────────────────────");
});

async function expectSettled(page: import("@playwright/test").Page) {
  const { expect } = await import("@playwright/test");
  await expect
    .poll(async () => {
      try {
        const t = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
        return t.length > 250 && !/loading/i.test(t);
      } catch {
        return false;
      }
    }, { timeout: 25_000, intervals: [400] })
    .toBe(true)
    .catch(() => {
      // Not a failure: a screen that never settles is exactly what this reports.
    });
}
