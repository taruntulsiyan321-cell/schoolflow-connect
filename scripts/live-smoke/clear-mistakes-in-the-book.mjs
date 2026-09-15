/**
 * LIVE SMOKE: can a student actually get OUT of relearn?
 *
 *   SP=<scratch> ANON=<anon key> ROLE=student12 CHAPTER=Matrices \
 *     node scripts/live-smoke/clear-mistakes-in-the-book.mjs
 *
 * WHY THIS EXISTS
 * A chapter above RECOVERY_WIDE_MAX_MISTAKES is put in `relearn`: no recovery
 * session is offered, because drilling variants is the wrong answer to that
 * many mistakes. The spec allows exactly two ways for an entry to leave the
 * book — "from the mistake book or from the recovery report" — and above the
 * boundary the recovery report is unreachable. So the mistake book is the ONLY
 * exit, and nothing in this repo has ever checked that it works.
 *
 * It matters because ordinary practice cannot clear anything: a wrong answer
 * upserts `status='open', cleared_at=NULL` and bumps times_wrong, so the open
 * count only ever rises. If the book's retry is broken too, relearn is a trap
 * with no way out at all.
 *
 * WHAT IT MEASURES
 * The open-mistake count for the chapter, straight from the database, before
 * and after the retry. Not the screen, not the button — the count the recovery
 * engine actually reads.
 *
 * THE POSITIVE CONTROL
 * WRONG=1 answers every question incorrectly. The retry clears only on a score
 * of 70 or better, so that run MUST leave the count unchanged. A check that
 * passes in both directions is measuring nothing; run it both ways.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const ROLE = process.env.ROLE || "student12";
const CHAPTER = process.env.CHAPTER || "Matrices";
const ANON = process.env.ANON;
const WRONG = process.env.WRONG === "1";
if (!ANON) { console.error("ANON (anon key) is required"); process.exit(2); }

const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/shots`, { recursive: true });

const REST = `https://${REF}.supabase.co/rest/v1`;
const hdr = { apikey: ANON, Authorization: `Bearer ${s.access_token}` };

/** Open mistakes for this chapter, read as the student under RLS. */
async function openMistakes() {
  const url = `${REST}/student_mistakes?select=id,question_text,correct_answer,options`
    + `&status=eq.open&chapter=ilike.*${encodeURIComponent(CHAPTER)}*`;
  const r = await fetch(url, { headers: hdr });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const before = await openMistakes();
console.log(`BEFORE: ${before.length} open mistake(s) in ${CHAPTER}`);
if (before.length === 0) { console.log("nothing to clear — no fixture"); process.exit(1); }

// Rendered option set -> correct index. Matching on the OPTIONS rather than on
// the question text is deliberate: the first version located the question with
// a CSS selector, that selector matched something else, and every lookup missed
// silently while the run answered option A forty times. The option list is the
// thing being clicked, so it is the thing worth matching on.
const norm = (t) => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const fingerprint = (opts) => opts.map(norm).join(" | ");
const correctByFingerprint = new Map();
// The same shape spread the app itself got wrong: practice writes `index`,
// older rows carry `indexes`/`correct_index`, and some carry only the text.
const indexOf = (ca, opts) => {
  if (ca == null) return null;
  if (typeof ca === "object") {
    if (Array.isArray(ca.indexes) && typeof ca.indexes[0] === "number") return ca.indexes[0];
    for (const k of ["index", "correct_index", "selected_index"]) {
      if (typeof ca[k] === "number") return ca[k];
    }
    if (typeof ca.text === "string") {
      const i = opts.findIndex((o) => norm(o) === norm(ca.text));
      if (i >= 0) return i;
    }
    return null;
  }
  if (typeof ca === "string") {
    const i = opts.findIndex((o) => norm(o) === norm(ca));
    if (i >= 0) return i;
    if (/^[A-Za-z]$/.test(ca.trim())) {
      const p = ca.trim().toUpperCase().charCodeAt(0) - 65;
      return p >= 0 && p < opts.length ? p : null;
    }
  }
  return null;
};
for (const m of before) {
  const opts = Array.isArray(m.options) ? m.options : [];
  const ci = indexOf(m.correct_answer, opts);
  if (opts.length && ci != null) correctByFingerprint.set(fingerprint(opts), ci);
}
console.log(`fixture: ${correctByFingerprint.size} of ${before.length} mistake(s) have a usable option set`);

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({ viewport:{width:1280,height:950} })).newPage();
const errors = [];
const VERBOSE_EARLY = process.env.VERBOSE === "1";
page.on("pageerror", e => errors.push(String(e).slice(0,140)));
page.on("console", m => {
  const t = m.text();
  if (m.type()==="error" && !/WebSocket|realtime|403/.test(t)) errors.push(t.slice(0,140));
  // The clearing path swallows its failures into console.warn and a toast that
  // is gone in three seconds, so a run that clears nothing looks identical to a
  // run that cleared everything. Surface them.
  if (VERBOSE_EARLY || /mistake retry|Could not|Failed to clear|mastery not updated/i.test(t)) {
    console.log(`[app ${m.type()}]`, t.slice(0, 220));
  }
});
// The write that clearing is: a PATCH of student_mistakes. If it never happens,
// the defect is upstream of the database.
const VERBOSE = VERBOSE_EARLY;
let lastRequestAt = Date.now();
page.on("request", r => {
  if (/supabase\.co/.test(r.url()) && !/realtime/.test(r.url())) lastRequestAt = Date.now();
  const u = r.url();
  if (!/supabase\.co/.test(u) || /realtime/.test(u)) return;
  if (r.method() === "GET" && !VERBOSE) {
    if (!/student_mistakes/.test(u)) return;
  }
  if (VERBOSE || r.method() !== "GET" || /student_mistakes/.test(u)) {
    console.log(`[req ${r.method()}]`, decodeURIComponent(u).replace(/apikey=[^&]+/,"").slice(0, 150));
  }
});
page.on("response", async r => {
  if (/student_mistakes|rpc\//.test(r.url()) && r.status() >= 400) {
    console.log(`[HTTP ${r.status()}]`, decodeURIComponent(r.url()).slice(0,140),
      (await r.text().catch(()=>"")).slice(0,160));
  }
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

await page.goto("http://127.0.0.1:5173/student/mistakes", { waitUntil: "domcontentloaded" });
// Wait for the BOOK, not for the word "mistake" — the nav carries "Mistake
// Book", so a text probe matches before a single row has loaded and the run
// reads an empty page as an empty book. Cost me one wrong diagnosis.
await page.waitForSelector('button:has-text("visible unresolved mistakes")', { timeout: 60000 })
  .catch(() => {});

// Narrow to the chapter, then take the book's own "practise these" entry.
await page.fill('input[placeholder*="Search questions"]', CHAPTER).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SP}/shots/30-book.png`, fullPage: true });

const start = page.locator('button:has-text("visible unresolved mistakes")').first();
if (!(await start.count())) {
  console.log("!! no 'Practice N visible unresolved mistakes' button");
  console.log("   screen:", ((await page.textContent("body")) ?? "").replace(/\s+/g," ").slice(0,300));
  await browser.close(); process.exit(1);
}
console.log("ENTRY:", (await start.innerText()).replace(/\s+/g," "));
await start.click({ timeout: 5000 });
await page.waitForTimeout(1500);

const OPTS = 'button.w-full.text-left:has(span.w-6.h-6.rounded-lg)';
let asked = 0, answeredRight = 0, matched = 0, stalls = 0;
for (let i = 0; i < 40; i++) {
  const body = (await page.textContent("body")) ?? "";
  if (/Mistake Practice Complete/i.test(body)) break;

  if (!/Mistake Practice/i.test(body)) {
    console.log(`!! left the retry after ${asked} question(s) — now on: ${
      body.replace(/\s+/g," ").slice(0,90)}`);
    break;
  }

  const opts = page.locator(OPTS);
  const n = await opts.count();
  if (n === 0) { stalls++; if (stalls > 2) break; await page.waitForTimeout(800); continue; }

  // Strip the A/B/C/D chip the button renders before the option text.
  const texts = [];
  for (let k = 0; k < n; k++) {
    const raw = await opts.nth(k).innerText().catch(() => "");
    texts.push(raw.split("\n").slice(1).join(" ") || raw);
  }
  const want = correctByFingerprint.get(fingerprint(texts));
  if (want != null) matched++;

  let pick;
  if (WRONG) pick = want != null ? (want + 1) % n : 0;          // deliberately wrong
  else if (want != null && want < n) { pick = want; answeredRight++; }
  else pick = 0;                                                 // unknown -> guess

  const before_i = i;
  await opts.nth(pick).click({ timeout: 4000 }).catch(() => {});
  asked++;
  await page.waitForTimeout(700);

  // Bounded, always. An unbounded click on a button that never becomes
  // actionable is a 30s stall per question, and forty of those is twenty
  // minutes of a run that looks alive and is doing nothing.
  const nextBtn = page.locator('button:has-text("Next Question"), button:has-text("See Results")').first();
  if (await nextBtn.count()) {
    const ok = await nextBtn.click({ timeout: 4000 }).then(() => true).catch(() => false);
    if (!ok) {
      stalls++;
      if (stalls > 2) { console.log(`!! stuck at question ${before_i + 1}`); break; }
    }
  }
  await page.waitForTimeout(700);
}
console.log(`option sets matched to the fixture: ${matched}/${asked}`);

/**
 * Wait for the completion writes to actually finish.
 *
 * This used to be waitForTimeout(4000), and that was measuring the harness
 * rather than the app: completeMistakeRetry starts a session, records each
 * attempt in a SEQUENTIAL await loop, then finishes, then clears. Four seconds
 * got 8 of 12 attempts out before browser.close() aborted the rest, so the
 * clear never ran and the run reported "cleared 0" as though the app had
 * refused. Wait for Supabase to go quiet instead.
 */
{
  const QUIET_MS = 4000, CAP_MS = 90000;
  const started = Date.now();
  while (Date.now() - lastRequestAt < QUIET_MS && Date.now() - started < CAP_MS) {
    await page.waitForTimeout(500);
  }
  console.log(`settled after ${Math.round((Date.now() - started) / 1000)}s of waiting`);
}
await page.screenshot({ path: `${SP}/shots/31-book-result.png`, fullPage: true });
console.log(`ASKED ${asked}, answered-correctly ${answeredRight}${WRONG ? " (POSITIVE CONTROL: all wrong)" : ""}`);
console.log("RESULT SCREEN:", ((await page.textContent("body")) ?? "").replace(/\s+/g," ").slice(0,400));

const after = await openMistakes();
console.log(`AFTER: ${after.length} open mistake(s) in ${CHAPTER}`);
console.log(`DELTA: ${before.length} -> ${after.length} (cleared ${before.length - after.length})`);
console.log("errors:", errors.length ? errors.slice(0,4).join(" | ") : "none");
await browser.close();
