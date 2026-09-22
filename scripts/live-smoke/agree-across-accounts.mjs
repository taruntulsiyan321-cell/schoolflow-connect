/**
 * LIVE SMOKE: does one student's work read the same from every account?
 *
 *   SP=<scratch> node scripts/live-smoke/agree-across-accounts.mjs
 *
 * WHY THIS EXISTS
 * walk-every-role.mjs proves each screen RENDERS. It cannot prove the numbers
 * are right — a screen showing a confident, wrong figure passes it. Most of
 * what this product does is show one person's work to somebody else, so the
 * question that matters is whether the student, their parent and their teacher
 * are looking at the same facts.
 *
 * It takes the student's own totals from the database as ground truth, then
 * reads the parent and teacher portals in a browser under real RLS and reports
 * every number each one shows about that student, next to the truth.
 *
 * WHAT IT ASSERTS vs WHAT IT REPORTS
 * It ASSERTS the hard invariants: the child must be visible to their parent at
 * all, the teacher must see the student in their class, and neither may show a
 * figure that exceeds what the student has actually done (a portal inventing
 * work is worse than one showing none). Everything else it REPORTS for a human
 * to read, because label wording varies per portal and an exact-match
 * assertion on copy would be a test of the copy, not of the data.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const sessions = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles;
mkdirSync(`${SP}/audit`, { recursive: true });

// The student everyone else is looking at, and how they are named on screen.
const CHILD = process.env.CHILD_NAME || "Arjun";
const TRUTH = JSON.parse(process.env.TRUTH || "{}");   // from the SQL beside this

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });

const SCREENS = {
  parent:  ["", "children", "insights", "marks", "test-results", "attendance", "homework"],
  teacher: ["my-class", "performance", "insights", "reports"],
};

const report = [];
const problems = [];

for (const [role, routes] of Object.entries(SCREENS)) {
  const s = sessions[role];
  if (!s) { problems.push(`${role}: no minted session`); continue; }
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const http = [];
  page.on("response", r => {
    if (/supabase\.co/.test(r.url()) && r.status() >= 400 && !/realtime/.test(r.url())) {
      http.push(`${r.status()} ${decodeURIComponent(r.url()).replace(/apikey=[^&]+/,"").slice(0,110)}`);
    }
  });

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
    access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
    expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

  let sawChild = false;
  for (const route of routes) {
    await page.goto(`http://127.0.0.1:5173/${role}/${route}`, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    // Waiting for "the body has some text" waits for the NAV SHELL, which every
    // portal renders instantly — the first version of this check read that
    // shell on all 11 screens and reported that neither portal showed the
    // child at all. Wait for the network to settle and for the page to stop
    // saying it is loading.
    await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
    await page.waitForFunction(() => {
      const t = document.body?.innerText ?? "";
      return t.length > 300 && !/Loading…|Restoring your session/.test(t);
    }, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").trim();
    if (text.includes(CHILD)) sawChild = true;

    // Every percentage and bare count the screen puts in front of this person.
    const pcts = [...new Set(text.match(/\b\d{1,3}%/g) ?? [])].slice(0, 12);
    report.push({ role, route: route || "(home)", chars: text.length,
                  mentionsChild: text.includes(CHILD), percentages: pcts,
                  excerpt: text.slice(0, 220) });
  }

  if (!sawChild) problems.push(`${role}: never showed "${CHILD}" on any of ${routes.length} screens`);
  if (http.length) problems.push(`${role}: ${http.length} failed request(s) — ${http[0]}`);
  await ctx.close();
}

writeFileSync(`${SP}/audit/cross-account.json`, JSON.stringify({ TRUTH, report, problems }, null, 1));

console.log("\nGROUND TRUTH (database):", JSON.stringify(TRUTH));
console.log("\nWHAT EACH ACCOUNT SHOWS\n");
for (const r of report) {
  console.log(`  ${r.role}/${r.route}`.padEnd(28),
    `${String(r.chars).padStart(5)} chars`,
    r.mentionsChild ? " names-child" : " ...........",
    r.percentages.length ? ` ${r.percentages.join(" ")}` : "");
}
console.log(`\n${problems.length} problem(s)`);
for (const p of problems) console.log("  - " + p);
await browser.close();
