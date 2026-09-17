/**
 * LIVE SMOKE: what does EACH Analysis tab actually show?
 *
 *   SP=<scratch> ROLE=student node scripts/live-smoke/every-analysis-tab.mjs
 *
 * WHY THIS EXISTS, BESIDE analysis-matches-the-database.mjs
 * That harness answers one question — do the three headline figures match the
 * rows? — and it merges every tab into one bag to do it. It therefore cannot
 * see the two defects this file is for:
 *
 *   · a figure that is WRONG rather than absent, on a tab nobody supplied a
 *     truth value for (study time, pace, "takes most time");
 *   · the SAME label carrying DIFFERENT values on two tabs, which merging
 *     hides by construction — the second write wins and the disagreement
 *     disappears before anything is compared.
 *
 * So this one keeps the tabs apart: every tab's figures and its own body text
 * are recorded under that tab's name, and the report is per tab plus a
 * cross-tab contradiction sweep.
 *
 * WHAT IT ASSERTS ON
 * Content, never the number of tabs visited. A run that opens six tabs and
 * reads nothing is a FAILED run, not a passing one — see the self-check.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const ROLE = process.env.ROLE || "student";
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/analysis`, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({ viewport:{width:1280,height:1800} })).newPage();
const http = [];
page.on("response", async r => {
  if (/supabase\.co/.test(r.url()) && r.status() >= 400 && !/realtime/.test(r.url()))
    http.push(`${r.status()} ${decodeURIComponent(r.url()).replace(/apikey=[^&]+/,"").slice(0,90)} :: ${(await r.text().catch(()=>"")).slice(0,90)}`);
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

/**
 * Label -> value for the tab on screen.
 *
 * Analysis writes a figure in three shapes, and a reader that knows only one
 * of them reports the other two as missing:
 *   A  <p>Practice accuracy: <strong>28%</strong></p>
 *   B  <div>35</div><div>Open mistakes</div>          (stat tile, value first)
 *   C  <div>18</div><div>7 questions · 2h study time</div>
 * C is why the value pattern allows a unit suffix (h, m, s, %) — "0h" and "7m"
 * are figures, and they are exactly the ones in dispute.
 */
const readFigures = () => page.evaluate(() => {
  const out = {};
  const VALUE = /^[0-9][0-9,]*(\.[0-9]+)?\s*(%|h|m|s|min|hrs?)?$/;
  for (const p of Array.from(document.querySelectorAll("p"))) {
    const strong = p.querySelector("strong");
    if (!strong) continue;
    const whole = (p.textContent || "").trim();
    const val = (strong.textContent || "").trim();
    const label = whole.slice(0, whole.length - val.length).replace(/[:\s]+$/, "").trim();
    if (label && val && !(label in out)) out[label] = val;
  }
  for (const el of Array.from(document.querySelectorAll("div,span"))) {
    if (el.children.length) continue;
    const v = (el.textContent || "").trim();
    if (!VALUE.test(v) && v !== "—") continue;
    const parent = el.parentElement;
    if (!parent) continue;
    for (const sib of Array.from(parent.children)) {
      if (sib === el) continue;
      const t = (sib.textContent || "").trim();
      if (t && t.length < 34 && /[A-Za-z]/.test(t)) { if (!(t in out)) out[t] = v; break; }
    }
  }
  return out;
});

/** Click a tab in the Analysis tab bar — never the sidebar item of one name. */
const openTab = (want) => page.evaluate((label) => {
  const bars = Array.from(document.querySelectorAll("div"))
    .filter((d) => /border-b/.test(d.className || "") && d.querySelectorAll("button").length >= 3);
  for (const bar of bars) {
    for (const b of Array.from(bar.querySelectorAll("button"))) {
      if ((b.textContent || "").trim() === label) { b.click(); return true; }
    }
  }
  return false;
}, want);

await page.goto("http://127.0.0.1:5173/student/analysis", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /Analysis/i.test(document.body?.innerText ?? ""), { timeout: 30000 }).catch(()=>{});
await page.waitForTimeout(12000);

const TABS = ["Overview", "Subjects & Chapters", "Topics", "Practice", "Activity & Speed", "Milestones & Reports"];
/** @type {Record<string,{figures:Record<string,string>,text:string,chars:number}>} */
const perTab = {};
for (const tab of TABS) {
  if (tab !== "Overview") {
    if (!await openTab(tab).catch(() => false)) { perTab[tab] = { figures: {}, text: "!! TAB BUTTON NOT FOUND", chars: 0 }; continue; }
    await page.waitForTimeout(3500);
  }
  const figures = await readFigures().catch(() => ({}));
  const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  perTab[tab] = { figures, text, chars: text.length };
  await page.screenshot({ path: `${SP}/analysis/tab-${tab.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(()=>{});
}
writeFileSync(`${SP}/analysis/per-tab.json`, JSON.stringify(perTab, null, 1));

console.log(`\nEVERY ANALYSIS TAB — ${ROLE}\n`);

// SELF-CHECK. A harness that read nothing must say so rather than report the
// product as empty. Positive control: delete the readFigures body and this
// trips instead of printing six clean tabs.
const totalFigures = Object.values(perTab).reduce((n, t) => n + Object.keys(t.figures).length, 0);
if (totalFigures < 8) {
  console.log("!! HARNESS COULD NOT READ THE PAGE — refusing to report on the app.");
  console.log("   sample:", (perTab.Overview?.text ?? "").slice(0, 220));
  await browser.close();
  process.exit(2);
}

let problems = 0;
for (const tab of TABS) {
  const t = perTab[tab];
  const keys = Object.keys(t.figures);
  console.log(`── ${tab}  (${keys.length} figures, ${t.chars} chars)`);
  if (t.text.startsWith("!!")) { problems++; console.log("   !! tab not reachable"); continue; }
  if (keys.length === 0) { problems++; console.log("   !! renders no figure at all"); }
  for (const k of keys) console.log(`   ${k.padEnd(30)} ${t.figures[k]}`);
  // An empty-state string is honest; a broken number never is.
  for (const bad of ["NaN", "Infinity", "undefined", "null%", "[object"]) {
    if (t.text.includes(bad)) { problems++; console.log(`   !! renders "${bad}"`); }
  }
  console.log("");
}

// CROSS-TAB CONTRADICTION.
//
// One label, two tabs, two values is the defect this file exists for —
// "Study time total 6m" on Overview beside "Total study time 0h" on Activity
// & Speed, off one heat map. Merging the tabs together is what used to hide
// it.
//
// BUT A BLANKET SWEEP OVER EVERY REPEATED LABEL CRIES WOLF. "Accuracy" is a
// page-wide rate on Overview, one chapter's rate on Subjects & Chapters, and
// this month's on Activity & Speed. Those SHOULD differ, and a harness that
// reports them is one whose output gets skimmed and then ignored — which is
// how the next real contradiction gets through.
//
// So the strict check is over labels that name ONE page-wide quantity. Every
// other repeated label with a differing value is printed as context and
// counted as nothing.
const PAGE_WIDE = [
  // The same minutes, from snapshot.activity_heatmap, rendered in three places.
  ["Study time (4 weeks)"],
  // The same pace, from deriveSpeedStats, on Overview and on Practice.
  ["Average time per question", "Average per question"],
  // The same count, from the snapshot, on the header row and the Topics tiles.
  ["Open mistakes"],
  ["Practice accuracy"],
  ["Skipped"],
];

// EVERY tab that shows a label in the group, not the first one that does.
// Taking the first is what let two tiles that now share a label — "Study time
// (4 weeks)" on Overview and on Activity & Speed — stop being compared at all
// the moment the labels were made to match.
const sightings = (labels) => {
  const out = [];
  for (const tab of TABS) {
    for (const label of labels) {
      const v = perTab[tab]?.figures?.[label];
      if (v !== undefined) out.push({ tab, label, value: v });
    }
  }
  return out;
};

for (const group of PAGE_WIDE) {
  const found = sightings(group);
  if (found.length < 2) continue;
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length > 1) {
    problems++;
    console.log(`!! one quantity, ${distinct.length} answers: ` +
      found.map((f) => `${f.value} (${f.label} on ${f.tab})`).join("  vs  "));
  }
}

// Context only — never counted.
const seen = new Map();
const scoped = [];
for (const tab of TABS) {
  for (const [k, v] of Object.entries(perTab[tab]?.figures ?? {})) {
    const prior = seen.get(k);
    if (prior && prior.value !== v) scoped.push(`"${k}" ${prior.value} on ${prior.tab}, ${v} on ${tab}`);
    else if (!prior) seen.set(k, { tab, value: v });
  }
}
if (scoped.length) {
  console.log("── same label, different scope (not a contradiction) ──");
  for (const line of scoped) console.log("   " + line);
  console.log("");
}

if (http.length) { problems++; console.log(`\n${http.length} failed request(s):`); for (const h of http.slice(0, 4)) console.log("   " + h); }
console.log(`\n${problems} problem(s)\n`);
await browser.close();
process.exit(problems > 0 ? 1 : 0);
