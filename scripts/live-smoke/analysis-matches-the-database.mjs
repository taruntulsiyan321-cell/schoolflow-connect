/**
 * LIVE SMOKE: does Analysis show the numbers the database holds?
 *
 *   SP=<scratch> ROLE=student TRUTH='{"accuracy_pct":28.2,...}' \
 *     node scripts/live-smoke/analysis-matches-the-database.mjs
 *
 * WHY THIS EXISTS
 * audit-four-tabs proves Analysis RENDERS; walk-every-role proves it renders
 * for everyone. Neither can tell a right number from a confident wrong one, and
 * every figure defect found this week rendered perfectly: 33% on one screen and
 * 40% on another for the same sitting; a chapter under a "topic" heading;
 * "Nothing flagged yet" beside "2 topics need attention"; an "Open mistakes"
 * tile reading 69 for a student with 35.
 *
 * ── WHY THIS FILE REPLACES analysis-says-what-the-data-says.mjs ──────────────
 *
 * That one was patched four times and was wrong each time, because it scraped
 * the flattened body text:
 *
 *   · "69Open mistakes19Topics to revisit" — matching after the label returns
 *     the NEXT tile's number (reported 19 for a tile showing 69)
 *   · matching before the label reaches across the page and returns the first
 *     decimal anywhere (reported 86.2)
 *   · `button:has-text("Practice")` matched the SIDEBAR, so it navigated away
 *     from Analysis and read the following figures off the wrong screen
 *
 * Patching a reader that cannot see the structure was the mistake. This one is
 * built from the markup Analysis actually uses, which is two shapes:
 *
 *   A  <p>Practice accuracy: <strong>28%</strong></p>      (summary rows)
 *   B  <div>35</div><div>Open mistakes</div>               (stat tiles)
 *
 * A sibling-only reader can never see shape A — the label and value share one
 * element. Both are read here, in one evaluate per tab.
 *
 * ── THE SELF-CHECK ──────────────────────────────────────────────────────────
 *
 * If the extractor finds almost nothing it says so, instead of reporting the
 * app as empty. A harness that cannot read must never look like a product that
 * has no data.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const ROLE = process.env.ROLE || "student";
const TRUTH = JSON.parse(process.env.TRUTH || "{}");
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/analysis`, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({ viewport:{width:1280,height:1600} })).newPage();
const http = [];
page.on("response", async r => {
  if (/supabase\.co/.test(r.url()) && r.status() >= 400 && !/realtime/.test(r.url()))
    http.push(`${r.status()} ${(await r.text().catch(()=>"")).slice(0,110)}`);
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

/** Every label -> value the CURRENT tab exposes, in both of the page's shapes. */
const readFigures = () => page.evaluate(() => {
  const out = {};
  // Shape A — label and value in one <p>, the value in a <strong>.
  for (const p of Array.from(document.querySelectorAll("p"))) {
    const strong = p.querySelector("strong");
    if (!strong) continue;
    const whole = (p.textContent || "").trim();
    const val = (strong.textContent || "").trim();
    const label = whole.slice(0, whole.length - val.length).replace(/[:\s]+$/, "").trim();
    if (label && val && !(label in out)) out[label] = val;
  }
  // Shape B — a numeric leaf with a short text sibling.
  for (const el of Array.from(document.querySelectorAll("div,span"))) {
    if (el.children.length) continue;
    const v = (el.textContent || "").trim();
    if (!/^[0-9]+(\.[0-9]+)?%?$/.test(v)) continue;
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

/** Click a tab inside the tab bar — never the sidebar item of the same name. */
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
await page.waitForTimeout(11000);

const TABS = ["Overview", "Subjects & Chapters", "Topics", "Practice", "Activity & Speed"];
const figures = {};
const tabsSeen = [];
const tabBodies = {};
for (const tab of TABS) {
  if (tab !== "Overview") {
    const ok = await openTab(tab).catch(() => false);
    if (!ok) continue;
    await page.waitForTimeout(3200);
  }
  tabsSeen.push(tab);
  Object.assign(figures, await readFigures().catch(() => ({})));
  // Capture the Topics tab's own text WHILE ON IT. Reading it after the loop
  // reads whichever tab happened to be last (Activity & Speed), where the weak
  // topics are not rendered — which reported a topic "MISSING" that the Topics
  // tab was showing correctly.
  if (tab === "Topics") {
    tabBodies.Topics = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  }
}
const topicsText = tabBodies.Topics
  ?? ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
await page.screenshot({ path: `${SP}/analysis/tabs.png`, fullPage: true }).catch(()=>{});
writeFileSync(`${SP}/analysis/figures.json`, JSON.stringify({ tabsSeen, figures }, null, 1));

console.log(`\nANALYSIS vs THE DATABASE — ${ROLE}`);
console.log(`tabs opened: ${tabsSeen.join(", ")}`);
console.log(`figures read: ${Object.keys(figures).length}\n`);

// SELF-CHECK: could not read is not the same as nothing to show.
if (Object.keys(figures).length < 3) {
  console.log("!! HARNESS COULD NOT READ THE PAGE — refusing to report on the app.");
  console.log("   sample of what was on screen:", topicsText.slice(0, 200));
  await browser.close();
  process.exit(2);
}

const num = (v) => v === undefined || v === null ? null : Number(String(v).replace(/[%,]/g, ""));
const checks = [
  ["Practice accuracy", num(figures["Practice accuracy"]), Math.round(TRUTH.accuracy_pct ?? -1)],
  ["Open mistakes",     num(figures["Open mistakes"]),     TRUTH.open_mistakes],
  ["Skipped",           num(figures["Skipped"]),           TRUTH.skipped],
];

let bad = 0;
for (const [label, shown, expected] of checks) {
  if (expected === undefined || expected < 0) { console.log(`  ${label.padEnd(20)} shown ${shown ?? "—"} (no truth supplied)`); continue; }
  if (shown === null) {
    bad++;
    console.log(`  ${label.padEnd(20)} NOT ON ANY TAB (data says ${expected})`);
    continue;
  }
  const ok = Math.abs(shown - expected) <= 1;         // a point for rounding
  if (!ok) bad++;
  console.log(`  ${label.padEnd(20)} ${ok ? "MATCH   " : "MISMATCH"}  shown ${shown}   data ${expected}`);
}
for (const name of TRUTH.weak_topic_names ?? []) {
  const ok = topicsText.includes(name);
  if (!ok) bad++;
  console.log(`  ${"weak topic".padEnd(20)} ${ok ? "MATCH   " : "MISSING "}  ${name}`);
}
if (http.length) { bad++; console.log(`\n  ${http.length} failed request(s): ${http[0]}`); }
console.log(`\n${bad} problem(s)\n`);
await browser.close();
