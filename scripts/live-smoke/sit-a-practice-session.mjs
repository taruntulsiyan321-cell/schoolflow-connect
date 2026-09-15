/**
 * LIVE SMOKE: drive the real app, in a real browser, as a real student.
 *
 *   npm run dev -- --port 5173 --host 127.0.0.1
 *   SUPABASE_ACCESS_TOKEN=... node scripts/mint-role-sessions.mjs <scratch>/sessions.json
 *   SP=<scratch> node scripts/live-smoke/sit-a-practice-session.mjs
 *
 * WHY THIS EXISTS
 * Every gate in this repo checks the database or the types. None of them opens
 * the app. Two defects found on 2026-09-15 were invisible to all of them and
 * obvious within a minute of looking:
 *
 *   - chapter practice loaded NOTHING for a chapter holding 43 questions,
 *     because the chapter filter ran client-side over a capped fetch;
 *   - the Overview tab printed 10 correct, 14 incorrect and "Accuracy 36%",
 *     which is not what 10 of 24 comes to.
 *
 * BROWSER AND PROXY NOTES (this container)
 * Chromium 127+ on Linux uses the Chrome Root Store, so it ignores both the
 * system trust store and ~/.pki/nssdb. The agent proxy's CA is therefore
 * pinned by SPKI hash below: that trusts exactly one key and leaves every
 * other certificate verified normally. It is NOT --ignore-certificate-errors.
 * The repo's playwright pins a browser build this image does not carry, so
 * executablePath points at the pre-installed one.
 *
 * It uses a REAL GoTrue session from mint-role-sessions.mjs, so everything
 * runs under real RLS as that student and never as a bypassing superuser.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles.student;
mkdirSync(`${SP}/shots`, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({ viewport:{width:1280,height:950} })).newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0,140)));
page.on("console", m => { if (m.type()==="error" && !/WebSocket|realtime|403/.test(m.text())) errors.push(m.text().slice(0,140)); });

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

const OPT = 'button.rounded-2xl.border.text-left';
await page.goto("http://127.0.0.1:5173/student/practice?chapter=Arithmetic%20Progressions&subject=Mathematics",
  { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /Q1 of/.test(document.body?.innerText ?? ""), { timeout: 60000 });
await page.screenshot({ path: `${SP}/shots/10-question.png` });

let answered = 0, skipped = 0;
for (let i = 0; i < 25; i++) {
  const txt = (await page.textContent("body")) ?? "";
  if (!/Q\d+ of/.test(txt)) break;

  const opts = page.locator(OPT);
  const n = await opts.count();
  if (n === 0) break;

  // Answer most, SKIP a few on purpose: skipping is a real student behaviour
  // and it is what the "skips are not wrong answers" fix depends on.
  if (i % 5 === 4) {
    const sk = page.locator('button:has-text("Skip")').first();
    if (await sk.count()) { await sk.click().catch(()=>{}); skipped++; }
  } else {
    await opts.nth(i % n).click({ timeout: 5000 }).catch(()=>{});
    answered++;
  }
  await page.waitForTimeout(700);
  for (const label of ["Next question","Next","Continue","See results","Finish"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); break; }
  }
  await page.waitForTimeout(700);
}

// Finish if still running.
for (const label of ["End Session","Finish","See results"]) {
  const b = page.locator(`button:has-text("${label}")`).first();
  if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); break; }
}
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SP}/shots/11-result.png`, fullPage: true });
console.log(`answered ${answered}, skipped ${skipped}`);
console.log("RESULT SCREEN:", (await page.textContent("body")).replace(/\s+/g," ").slice(0, 520));
console.log("errors:", errors.length ? errors.slice(0,4).join(" | ") : "none");
await browser.close();
