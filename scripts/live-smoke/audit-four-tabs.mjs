/**
 * LIVE AUDIT: practice, analysis, recovery, revision — every tab, every glitch.
 *
 *   SP=<scratch> node scripts/live-smoke/audit-four-tabs.mjs
 *
 * Looks for the things a human notices and a unit test cannot:
 *   - failed network requests (4xx/5xx), not just console errors
 *   - React render errors
 *   - placeholder text that leaked to screen: NaN, undefined, [object Object],
 *     Invalid Date, "null"
 *   - a screen that renders nothing
 *   - every in-page tab, clicked
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
// ROLE is selectable so this can be re-run against a student whose state
// suits the flow under test. Repeated runs push one student into relearn
// on every chapter, and then the recovery path has no fixture.
const ROLE = process.env.ROLE || "student";
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/audit`, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({viewport:{width:1280,height:1100}})).newPage();

const findings = [];
let where = "boot";
const note = (kind, detail) => findings.push({ where, kind, detail: String(detail).slice(0, 240) });

page.on("pageerror", e => note("RENDER ERROR", e));
page.on("console", m => {
  const t = m.text();
  if (m.type() !== "error") return;
  // Realtime websockets cannot traverse the agent proxy; that is the harness,
  // not the app, and saying so keeps the real findings readable.
  if (/WebSocket|realtime/i.test(t)) return;
  note("CONSOLE ERROR", t);
});
page.on("response", r => {
  const u = r.url();
  if (!/supabase\.co|127\.0\.0\.1:5173/.test(u)) return;
  if (/realtime/.test(u)) return;
  if (r.status() >= 400) note("HTTP " + r.status(), u.replace(/apikey=[^&]+/, "apikey=…").slice(0, 200));
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

const BAD = [
  [/\bNaN\b/, "NaN on screen"],
  [/\bundefined\b/, "'undefined' on screen"],
  [/\[object Object\]/, "[object Object] on screen"],
  [/Invalid Date/, "Invalid Date on screen"],
  [/\bnull\b/, "'null' on screen"],
  [/\bInfinity\b/, "Infinity on screen"],
];

async function settle() {
  await page.waitForFunction(() => {
    const t = document.body?.innerText ?? "";
    return t.length > 60 && !/Restoring your session/.test(t);
  }, { timeout: 15000 }).catch(() => note("SLOW", "never finished loading in 15s"));
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function scan(label) {
  const t = (await page.textContent("body")) ?? "";
  if (t.replace(/\s+/g, " ").trim().length < 120) note("EMPTY SCREEN", "rendered almost nothing");
  for (const [re, msg] of BAD) if (re.test(t)) {
    const m = t.match(new RegExp(".{0,60}" + re.source + ".{0,60}"));
    note("PLACEHOLDER", `${msg} — …${(m?.[0] ?? "").replace(/\s+/g," ").trim()}…`);
  }
  await page.screenshot({ path: `${SP}/audit/${label}.png`, fullPage: true });
}

const TABS = [
  ["practice", "/student/practice"],
  ["analysis", "/student/analysis"],
  ["recovery", "/student/recovery"],
  ["revision", "/student/revision"],
];

for (const [name, url] of TABS) {
  where = name;
  await page.goto(`http://127.0.0.1:5173${url}`, { waitUntil: "domcontentloaded" });
  await settle();
  await scan(`${name}-main`);

  // Click every in-page tab this screen offers.
  //
  // NOT `nav button`. That matched the SIDEBAR — Home, Practice, Learning,
  // Class — so the sweep navigated away from the screen it was auditing and
  // then re-scanned the page it had landed on, up to ten times, scoring the
  // same nav item as a "tab" of every screen. The screenshots gave it away:
  // analysis-6-Home, analysis-7-Practice, analysis-8-Learning, all byte-identical.
  // A run could take half an hour and its "0 findings across every in-page tab"
  // was partly a statement about the sidebar.
  //
  // Scoped to the main region and to controls that actually declare themselves
  // tabs, with the sidebar excluded outright.
  const tabs = await page.locator(
    'main [role="tab"], main button[data-state], [role="tablist"] button'
  ).all();
  for (let i = 0; i < Math.min(tabs.length, 10); i++) {
    const label = ((await tabs[i].textContent()) ?? "").trim().slice(0, 30) || `tab${i}`;
    where = `${name} › ${label}`;
    await tabs[i].click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await scan(`${name}-${i}-${label.replace(/[^a-z0-9]+/gi, "_").slice(0, 20)}`);
  }
}

writeFileSync(`${SP}/audit/findings.json`, JSON.stringify(findings, null, 1));
console.log(`\n${findings.length} finding(s)\n`);
const seen = new Set();
for (const f of findings) {
  const k = f.kind + "|" + f.detail.slice(0, 90);
  if (seen.has(k)) continue; seen.add(k);
  console.log(`  [${f.where}] ${f.kind}: ${f.detail}`);
}
await browser.close();
