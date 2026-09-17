/**
 * LIVE SMOKE: start a recovery session from the Recovery tab and finish it.
 *   SP=<scratch> node scripts/live-smoke/sit-a-recovery-session.mjs
 * See walk-student-screens.mjs for the browser/proxy notes.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
// ROLE is selectable so this can be re-run against a student whose state
// suits the flow under test. Repeated runs push one student into relearn
// on every chapter, and then the recovery path has no fixture.
const ROLE = process.env.ROLE || "student";
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/shots`, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({viewport:{width:1280,height:1000}})).newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0,140)));
// A refused start shows the student a toast that is gone in seconds and shows
// a smoke run nothing at all. Capture the server's own words.
const failures = [];
page.on("response", async r => {
  if (!/supabase\.co/.test(r.url()) || r.status() < 400) return;
  const body = await r.text().catch(() => "");
  failures.push(`${r.status()} ${decodeURIComponent(r.url()).replace(/apikey=[^&]+/,"").slice(0,110)} :: ${body.slice(0,220)}`);
});
const reportFailures = () => {
  for (const f of failures.slice(0, 6)) console.log("   FAILED REQUEST:", f);
  if (!failures.length) console.log("   (no 4xx/5xx — nothing was refused by the server)");
};
page.on("console", m => { if (m.type()==="error" && !/WebSocket|realtime|403/.test(m.text())) errors.push(m.text().slice(0,140)); });

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

await page.goto("http://127.0.0.1:5173/student/recovery", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /Open mistakes|Start recovery|relearn|drill/i.test(document.body?.innerText ?? ""),
  { timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${SP}/shots/30-recovery-tab.png`, fullPage: true });
const tab = (await page.textContent("body")).replace(/\s+/g," ");
console.log("RECOVERY TAB:", tab.slice(tab.indexOf("Recovery"), tab.indexOf("Recovery") + 620));

// CHAPTER picks WHICH card to start, rather than whichever happens to be
// first. Without it an end-to-end run that just practised one chapter gets a
// recovery session for a different one, and the chain proves nothing.
const CHAPTER = process.env.CHAPTER || null;
// Scoped to the CARD, not to any div containing the name. `locator('div')`
// matches every ancestor too, including the container holding all the cards,
// so filtering it by chapter name then taking a button picked whichever card
// happened to be last — a run asking for Matrices started a different chapter.
const start = CHAPTER
  ? page.locator('button:has-text("Start recovery")').filter({
      has: page.locator(`xpath=ancestor::*[contains(., ${JSON.stringify(CHAPTER)})][1]`),
    }).first()
  : page.locator('button:has-text("Start recovery")').first();
const startBtn = CHAPTER && (await start.count()) === 0
  // Fall back to matching the card by its own text block.
  ? page.locator('div.rounded-2xl, [class*="GlassCard"], div').filter({
      hasText: new RegExp(`^(?=.*${CHAPTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}).{0,400}$`, "s"),
    }).locator('button:has-text("Start recovery")').first()
  : start;
if (!(await startBtn.count())) {
  console.log(`\nno 'Start recovery' button${CHAPTER ? ` for ${CHAPTER}` : ""} on the tab`);
  await browser.close(); process.exit(0);
}
await startBtn.click();
await page.waitForFunction(() => /Q1 of/.test(document.body?.innerText ?? ""), { timeout: 60000 })
  .catch(()=>{ console.log("!! recovery session never reached Q1"); reportFailures(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SP}/shots/31-recovery-q1.png` });
console.log("\nRECOVERY SESSION:", (await page.textContent("body")).replace(/\s+/g," ").slice(0,300));

const OPT = 'button.rounded-2xl.border.text-left';
for (let i = 0; i < 14; i++) {
  if (!/Q\d+ of/.test((await page.textContent("body")) ?? "")) break;
  const opts = page.locator(OPT); const n = await opts.count();
  if (!n) break;
  await opts.nth(0).click({ timeout: 5000 }).catch(()=>{});   // always pick A
  await page.waitForTimeout(650);
  for (const l of ["Next question","Next","Continue","See results","Finish"]) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); break; }
  }
  await page.waitForTimeout(650);
}
for (const l of ["End Session","Finish","See results"]) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); break; }
}
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SP}/shots/32-recovery-result.png`, fullPage: true });
console.log("\nRECOVERY RESULT:", (await page.textContent("body")).replace(/\s+/g," ").slice(0,600));
console.log("\nerrors:", errors.length ? errors.slice(0,4).join(" | ") : "none");
await browser.close();
