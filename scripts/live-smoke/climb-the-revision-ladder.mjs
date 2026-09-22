/**
 * LIVE SMOKE: does the revision ladder actually space out — 7, 7, 7, then 30?
 *
 *   SP=<scratch> ROLE=student CHAPTER="Polynomials" \
 *     KEY=<scratch>/answerkey.json \
 *     node scripts/live-smoke/climb-the-revision-ladder.mjs
 *
 * WHY THIS EXISTS, BESIDE sit-a-revision-check.mjs
 * That harness sits a check the way a student does — it clicks `nth(i % n)`,
 * which is quasi-random and lands well under REVISION_PASS_THRESHOLD. It has
 * therefore only ever produced `revision_failed`, and a failure RESTARTS the
 * ladder at stage 1. So every run this repository has ever done has exercised
 * one rung, and §5.3's schedule past it — stage 2, stage 3, and the drop to
 * REVISION_INTERVAL_SOLID — has never run at all.
 *
 * Proving the interval ladder needs a student who PASSES, three times. This
 * harness answers correctly on purpose, from a key computed out of band, and
 * asserts the booked interval after each rung.
 *
 * THE KEY IS NOT A CHEAT — IT IS THE POINT. The question under test is not
 * "can a bot answer Polynomials"; it is "given a pass, does the app book the
 * next check at the right distance". Random answering cannot ask that
 * question at all.
 *
 * The key file maps a question-text prefix to the correct option's TEXT, and
 * the harness clicks the option whose text matches. It holds no credential:
 * whoever builds the key reads the bank, and this file never does.
 *
 * WHAT IT ASSERTS
 * Content, from chapter_state, after each sitting:
 *   stage 1 pass -> stage 2, next check  7 days out
 *   stage 2 pass -> stage 3, next check  7 days out
 *   stage 3 pass -> stage 4, next check 30 days out, consecutive passes 3
 * A run that sits three checks and asserts nothing about the dates is not a
 * check of a schedule.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const SP = process.env.SP, REF = "psqxykzqfvxgsvkmgurn";
const ROLE = process.env.ROLE || "student";
const CHAPTER = process.env.CHAPTER || "Polynomials";
const KEY = JSON.parse(readFileSync(process.env.KEY || `${SP}/answerkey.json`, "utf8"));
const ROUNDS = Number(process.env.ROUNDS || 3);
const s = JSON.parse(readFileSync(`${SP}/sessions.json`, "utf8")).roles[ROLE];
if (!s) { console.error(`no session for role ${ROLE}`); process.exit(2); }
mkdirSync(`${SP}/ladder`, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox","--disable-dev-shm-usage",
         "--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk="] });
const page = await (await browser.newContext({ viewport:{width:1280,height:1100} })).newPage();
const failures = [];
page.on("response", async r => {
  // The WHOLE body and the URL. A 23514 truncated at 180 characters names a
  // constraint violation without naming the constraint or the table, which is
  // a bug report nobody can act on — and this harness found exactly that.
  if (/supabase\.co/.test(r.url()) && r.status() >= 400 && !/realtime/.test(r.url()))
    failures.push(`${r.status()} ${decodeURIComponent(r.url()).replace(/apikey=[^&]+/, "").slice(0, 140)}\n      ${(await r.text().catch(()=>"")).slice(0, 900)}`);
});
let lastRequestAt = Date.now();
page.on("request", r => { if (/supabase\.co/.test(r.url()) && !/realtime/.test(r.url())) lastRequestAt = Date.now(); });

await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(([r,t]) => localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
  access_token:t.access_token, refresh_token:t.refresh_token, expires_at:t.expires_at,
  expires_in:9999, token_type:"bearer", user:{id:t.user_id,email:t.email}})), [REF,s]);

const norm = (t) => (t || "").replace(/\s+/g, " ").trim();

/**
 * The option buttons render their letter inside the button: "Aax + b" is
 * option A, "ax + b". Comparing the raw text to the key therefore never
 * matched, and the first run of this harness answered 14 questions with 0
 * from the key and scored 38% — a failing check that looked like a driven
 * ladder. Strip the letter before comparing.
 */
const optionText = (t) => norm(t).replace(/^[A-D](?=[^a-z0-9]|[A-Za-z0-9])/, "").trim();

/**
 * The prompt is not the page text and not an h2 — measured, it is the
 * `previousElementSibling` of the options' container, and it carries the
 * subject, difficulty and chapter chips ahead of the question itself:
 *
 *   "MathematicsEasyPolynomialsIf the degree of a polynomial is 2, which..."
 *
 * So the key is matched as a SUBSTRING of that block rather than against a
 * startsWith, which the chips would defeat.
 */
function answerFor(promptBlock, optionTexts) {
  const hay = norm(promptBlock);
  let best = null;
  for (const [prefix, answer] of Object.entries(KEY)) {
    const needle = norm(prefix);
    if (needle.length < 20 || !hay.includes(needle)) continue;
    // THE KEY'S ANSWER MUST BE ON THIS QUESTION'S OPTION LIST.
    //
    // Without this the harness answered confidently and wrongly. A 45-character
    // probe matched "How many transitive relations are possible on a set with
    // 2 elements?" against the 3- and 4-element questions beside it in the
    // bank, and the key then named "3994" for a question whose options are 64,
    // 171, 256, 512. Clicking option 0 in that situation is a WRONG answer
    // recorded as a keyed one, which is how three rounds reported 10-of-14
    // "from the key" while quietly failing the third.
    if (!optionTexts.includes(norm(answer))) continue;
    if (!best || needle.length > best.len) best = { answer, len: needle.length };
  }
  return best?.answer ?? null;
}

const OPT = 'button.rounded-2xl.border.text-left';
const settle = async (quietMs = 4000, capMs = 90000) => {
  const started = Date.now();
  while (Date.now() - lastRequestAt < quietMs && Date.now() - started < capMs) await page.waitForTimeout(400);
};

const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  await page.goto("http://127.0.0.1:5173/student/revision", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /Take the check|No items due|Nothing due/i.test(document.body?.innerText ?? ""), { timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(2500);

  // TARGET THE CHAPTER'S OWN CARD. The Revision tab lists one card per due
  // chapter, each with its own "Take the check", and `.first()` takes
  // whichever sorts first — which is how the first run of this harness sat
  // Arithmetic Progressions three times while claiming to climb Polynomials,
  // and exhausted that chapter's unseen pool doing it.
  const started = await page.evaluate((chapter) => {
    for (const b of Array.from(document.querySelectorAll("main button"))) {
      if ((b.textContent || "").trim() !== "Take the check") continue;
      const card = b.closest("div[class*=rounded]");
      if ((card?.textContent || "").includes(chapter)) { b.click(); return true; }
    }
    return false;
  }, CHAPTER);
  if (!started) {
    console.log(`\nround ${round}: no "Take the check" for ${CHAPTER} on the Revision tab — cannot climb further.`);
    console.log("   screen says:", norm(await page.textContent("body")).slice(0, 320));
    break;
  }
  await page.waitForFunction(() => /Q1 of/.test(document.body?.innerText ?? ""), { timeout: 60000 })
    .catch(() => console.log(`!! round ${round}: the check never reached Q1`));
  await page.waitForTimeout(1200);

  let answered = 0, matched = 0;
  const unmatched = [];
  for (let i = 0; i < 25; i++) {
    const body = norm(await page.textContent("body"));
    if (!/Q\d+ of/.test(body)) break;
    const opts = page.locator(OPT);
    const n = await opts.count();
    if (!n) break;

    // Read the prompt from the block immediately above the options — see
    // answerFor — and click the option the key names.
    const optTexts = (await opts.allTextContents()).map(optionText);
    const prompt = await page.evaluate((sel) => {
      const first = document.querySelector(sel);
      return first?.parentElement?.previousElementSibling?.textContent ?? "";
    }, OPT);
    const keyed = answerFor(prompt, optTexts);
    let pick = 0;
    if (keyed) {
      pick = optTexts.indexOf(norm(keyed));
      matched++;
    } else {
      unmatched.push(`no key entry for: ${norm(prompt).slice(-80)}`);
    }
    await opts.nth(pick).click({ timeout: 5000 }).catch(()=>{});
    answered++;
    await page.waitForTimeout(600);
    for (const l of ["Next question","Next","Continue","See results","Finish"]) {
      const b = page.locator(`button:has-text("${l}")`).first();
      if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); break; }
    }
    await page.waitForTimeout(600);
  }
  for (const l of ["End Session","Finish","See results"]) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); break; }
  }
  await settle();
  const result = norm(await page.textContent("body"));
  await page.screenshot({ path: `${SP}/ladder/round-${round}.png`, fullPage: true }).catch(()=>{});
  results.push({ round, answered, matched, unmatched, result: result.slice(0, 420) });
  console.log(`\nround ${round}: answered ${answered}, ${matched} from the key`);
  // A round that answers questions it could not look up is not a pass
  // attempt, it is a random sitting wearing this harness's name. Say so.
  if (matched < answered) {
    console.log(`   !! ${answered - matched} answered WITHOUT a key match — this round cannot be read as a deliberate pass`);
    for (const u of unmatched.slice(0, 3)) console.log(`      ${u}`);
  }
  console.log(`   ${result.slice(0, 340)}`);
}

writeFileSync(`${SP}/ladder/rounds.json`, JSON.stringify({ chapter: CHAPTER, results, failures }, null, 1));
if (failures.length) { console.log(`\n${failures.length} failed request(s):`); for (const f of failures.slice(0, 5)) console.log("   " + f); }
console.log(`\nrounds sat: ${results.length} of ${ROUNDS}`);
console.log(`chapter_state is checked from SQL by the caller — this harness only drives the sittings.`);
await browser.close();
process.exit(results.length === 0 ? 1 : 0);
