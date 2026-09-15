/**
 * LIVE SMOKE: take a revision check from the Revision tab and finish it.
 *   SP=<scratch> node scripts/live-smoke/sit-a-revision-check.mjs
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
page.on("console", m => { if (m.type()==="error" && !/WebSocket|realtime|403/.test(m.text())) errors.push(m.text().slice(0,140)); });

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);
await page.goto("http://127.0.0.1:5173/student/revision", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /Take the check|No items due/i.test(document.body?.innerText ?? ""), { timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${SP}/shots/40-revision-tab.png`, fullPage: true });
const tab = (await page.textContent("body")).replace(/\s+/g," ");
console.log("REVISION TAB:", tab.slice(tab.indexOf("Revision"), tab.indexOf("Revision")+520));

const btn = page.locator('button:has-text("Take the check")').first();
if (!(await btn.count())) { console.log("\nno 'Take the check' button"); await browser.close(); process.exit(0); }
await btn.click();
await page.waitForFunction(() => /Q1 of/.test(document.body?.innerText ?? ""), { timeout: 60000 })
  .catch(()=>console.log("!! revision check never reached Q1"));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SP}/shots/41-revision-q1.png` });
console.log("\nCHECK SCREEN:", (await page.textContent("body")).replace(/\s+/g," ").slice(0,260));

const OPT = 'button.rounded-2xl.border.text-left';
for (let i = 0; i < 20; i++) {
  if (!/Q\d+ of/.test((await page.textContent("body")) ?? "")) break;
  const opts = page.locator(OPT); const n = await opts.count();
  if (!n) break;
  await opts.nth(i % n).click({ timeout: 5000 }).catch(()=>{});
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
await page.screenshot({ path: `${SP}/shots/42-revision-result.png`, fullPage: true });
console.log("\nRESULT:", (await page.textContent("body")).replace(/\s+/g," ").slice(0,620));
console.log("\nerrors:", errors.length ? errors.slice(0,4).join(" | ") : "none");
await browser.close();
