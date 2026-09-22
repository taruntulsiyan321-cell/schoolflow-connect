/**
 * LIVE SMOKE: every practice mode, in a real browser, under real RLS.
 *
 *   SP=<scratch> ROLE=student12 node scripts/live-smoke/every-practice-mode.mjs
 *
 * WHY THIS EXISTS
 * The four-tab audit proves a SCREEN renders. sit-a-practice-session proves ONE
 * mode loads. Nine modes ship, and the two defects that took practice down this
 * week — a select naming columns that no longer exist, and a topic that could
 * not be narrowed — each hit some modes and not others. A mode nobody drives is
 * a mode nobody knows about.
 *
 * WHAT IT ASSERTS PER MODE
 *   · it reaches a question, OR says honestly that it has none
 *   · the question text is real — not blank, not "undefined", not mojibake
 *   · the options are real, at least two of them, none blank
 *   · nothing 4xx'd on the way
 *
 * A mode with no content for this student is NOT a failure: "Bookmarked" with
 * no bookmarks should say so. Claiming questions it cannot show, or dying, is.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const ROLE = process.env.ROLE || "student12";
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/modes`, { recursive: true });

const SUBJECT = process.env.SUBJECT || "Mathematics";
const CHAPTER = process.env.CHAPTER || "Matrices";
const TOPIC   = process.env.TOPIC   || "Transpose of a Matrix";

/** Deep links the app itself honours. custom/pyq are driven through the hub. */
const URL_MODES = [
  ["weak",       `?mode=weak`],
  ["incorrect",  `?mode=incorrect`],
  ["skipped",    `?mode=skipped`],
  ["bookmarked", `?mode=bookmarked`],
  ["subject",    `?subject=${encodeURIComponent(SUBJECT)}`],
  ["chapter",    `?subject=${encodeURIComponent(SUBJECT)}&chapter=${encodeURIComponent(CHAPTER)}`],
  ["topic",      `?subject=${encodeURIComponent(SUBJECT)}&topic=${encodeURIComponent(TOPIC)}`],
];
const HUB_MODES = ["custom", "pyq"];

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({ viewport:{width:1280,height:1000} })).newPage();

let http = [];
page.on("response", async r => {
  if (!/supabase\.co/.test(r.url()) || r.status() < 400 || /realtime/.test(r.url())) return;
  http.push(`${r.status()} ${(await r.text().catch(()=>"")).slice(0,120)}`);
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

const OPT = 'button.rounded-2xl.border.text-left';
const BAD_TEXT = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Ã|â€|Â/];

/** Read the question currently on screen and judge whether it is presentable. */
async function inspectQuestion() {
  const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");

  // The counter is read from ITS OWN ELEMENT, never from the concatenated body.
  // In the body, "Q1 of 20" runs straight into "0/0 correct" and a greedy
  // \d+ turns 20 into 200 — which is how this harness first reported 200-, 160-
  // and 110-question sessions that never existed.
  // Verified against the real DOM rather than assumed. The counter is never a
  // bare "Q1 of 20": it renders as "Chapter Practice · Q1 of 20" inside one
  // element, so an anchored ^...$ match finds nothing (which made every mode
  // read NO QUESTION), and matching the whole body instead lets "Q1 of 20" run
  // into the "0/0 correct" beside it and become 200.
  //
  // So: the SHORTEST element whose text contains the counter — the most
  // specific node — and the regex applied to that element alone.
  const total = await page.evaluate(() => {
    let best = null;
    for (const el of Array.from(document.querySelectorAll("div,span,p,h1,h2,h3"))) {
      const t = (el.textContent || "").trim();
      if (t.length > 120 || !/Q\d+\s+of\s+\d+/.test(t)) continue;
      if (best === null || t.length < best.len) {
        const m = t.match(/Q(\d+)\s+of\s+(\d+)/);
        best = { len: t.length, total: Number(m[2]) };
      }
    }
    return best ? best.total : null;
  }).catch(() => null);
  if (total === null) return { reached: false, body };

  // Same reason: one evaluate instead of n round-trips.
  const texts = await page.evaluate((sel) =>
    Array.from(document.querySelectorAll(sel)).map(e => (e.textContent || "").trim()), OPT
  ).catch(() => []);
  const n = texts.length;

  // The question is the prompt above the options; take the longest bold line.
  // Read the prompt from the DOM in ONE evaluate. Four Playwright selectors
  // with allInnerTexts() cost minutes across nine modes on a dev-server build.
  // The prompt's real home: Practice.tsx renders <MathText> inside
  // div.text-base.font-semibold.leading-relaxed. Guessing at p/h2/h3 found
  // nothing and made every mode look broken.
  const qText = await page.evaluate(() => {
    const el = document.querySelector("div.text-base.font-semibold.leading-relaxed");
    return el ? (el.textContent || "").trim() : "";
  }).catch(() => "");

  const problems = [];
  if (!qText || qText.length < 8) problems.push("question text missing or too short");
  if (n < 2) problems.push(`only ${n} option(s)`);
  if (texts.some(t => !t || t.length < 1)) problems.push("a blank option");
  for (const re of BAD_TEXT) {
    if (re.test(qText)) problems.push(`question contains ${re}`);
    if (texts.some(t => re.test(t))) problems.push(`an option contains ${re}`);
  }
  return { reached: true, total, qText, options: texts, problems, body };
}

const results = [];

for (const [mode, qs] of URL_MODES) {
  http = [];
  await page.goto(`http://127.0.0.1:5173/student/practice${qs}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => /Q\d+ of|No questions|not available|Could not|nothing|empty/i.test(document.body?.innerText ?? ""),
    { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(1500);

  const r = await inspectQuestion();
  await page.screenshot({ path: `${SP}/modes/${mode}.png` }).catch(()=>{});
  results.push({ mode, ...r, http: [...http] });
}

// custom and pyq have no deep link: open the hub and drive the tiles.
for (const mode of HUB_MODES) {
  http = [];
  await page.goto("http://127.0.0.1:5173/student/practice", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const label = mode === "custom" ? "Custom Practice" : "Previous Year Questions";
  const tile = page.locator(`text=${label}`).first();
  if (!(await tile.count())) {
    results.push({ mode, reached: false, problems: [`no "${label}" tile on the hub`], http: [...http] });
    continue;
  }
  await tile.click({ timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(1800);
  // Pick the first option in every chooser the config screen shows, then start.
  for (const sel of ['button:has-text("Mathematics")', 'button:has-text("Mixed")']) {
    const b = page.locator(sel).first();
    if (await b.count()) { await b.click({ timeout: 3000 }).catch(()=>{}); await page.waitForTimeout(700); }
  }
  const chapterBtn = page.locator(`button:has-text("${CHAPTER}")`).first();
  if (await chapterBtn.count()) { await chapterBtn.click({timeout:3000}).catch(()=>{}); await page.waitForTimeout(700); }
  const start = page.locator('button:has-text("Start")').first();
  if (await start.count()) await start.click({ timeout: 5000 }).catch(()=>{});
  await page.waitForFunction(
    () => /Q\d+ of|No questions|not available|Could not/i.test(document.body?.innerText ?? ""),
    { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(1500);

  const r = await inspectQuestion();
  await page.screenshot({ path: `${SP}/modes/${mode}.png` }).catch(()=>{});
  results.push({ mode, ...r, http: [...http] });
}

writeFileSync(`${SP}/modes/results.json`, JSON.stringify(results, null, 1));

console.log(`\nPRACTICE MODES as ${ROLE} — ${SUBJECT} / ${CHAPTER} / ${TOPIC}\n`);
let bad = 0;
for (const r of results) {
  const probs = [...(r.problems ?? []), ...(r.http?.length ? [`${r.http.length} failed request(s): ${r.http[0]}`] : [])];
  if (!r.reached) {
    const honest = /no questions|nothing|none|empty|not available/i.test(r.body ?? "");
    const verdict = honest && !r.http?.length ? "EMPTY (says so)" : "NO QUESTION";
    if (verdict === "NO QUESTION") bad++;
    console.log(`  ${r.mode.padEnd(11)} ${verdict.padEnd(16)} ${(r.body ?? "").slice(0,90)}`);
    continue;
  }
  const verdict = probs.length ? "PROBLEM" : "OK";
  if (probs.length) bad++;
  console.log(`  ${r.mode.padEnd(11)} ${verdict.padEnd(16)} ${String(r.total).padStart(3)} q · ${r.options.length} opts · ${r.qText.slice(0,52)}`);
  for (const p of probs) console.log(`  ${"".padEnd(11)}   ! ${p}`);
}
console.log(`\n${bad} mode(s) with a problem, ${results.length - bad} clean\n`);
await browser.close();
