/**
 * Verifies cached question-bank content (from gen-via-openrouter.mjs) by
 * sending each chapter's questions back to the model as an independent
 * adversarial reviewer: re-solve every numerical question, check for
 * ambiguous options, corruption, and answer-explanation mismatches.
 * Rewrites the cache file in place — wrong questions are dropped or
 * corrected, never silently kept.
 *
 * Usage:
 *   node scripts/rbse-commerce-full/verify-cache.mjs <subject-key>
 *
 * Uses the same OPENROUTER_MODEL / OPENROUTER_API_KEY / budget guard as
 * gen-via-openrouter.mjs. Verification calls are billed the same way as
 * generation calls (free on the free tier, priced normally otherwise) —
 * the budget guard still applies.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const CACHE_DIR = path.join(__dirname, ".gen-cache");

function loadEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawVal.replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY not set. Aborting.");
  process.exit(1);
}

const BUDGET_LIMIT_USD = Number(process.env.QB_BUDGET_LIMIT_USD || 3.0);
const SAFETY_MARGIN_USD = 0.2;

let lastKnownUsage = null;

async function getRemoteUsageUsdOnce() {
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /key check failed: ${res.status}`);
  const json = await res.json();
  const usage = json?.data?.usage;
  if (typeof usage !== "number") throw new Error("Could not read usage from /key response");
  return usage;
}

/** Retries transient network failures before falling back to the last known
 * reading — a network blip during the budget check must not crash a run that
 * has real, safely-saved progress to protect. */
async function getRemoteUsageUsd() {
  const delays = [1000, 3000, 6000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const usage = await getRemoteUsageUsdOnce();
      lastKnownUsage = usage;
      return usage;
    } catch (e) {
      lastErr = e;
      if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  if (lastKnownUsage !== null) {
    console.log(`\n[budget check network error, using last known usage $${lastKnownUsage.toFixed(4)}: ${lastErr.message}]`);
    return lastKnownUsage;
  }
  throw lastErr;
}

class BudgetExceededError extends Error {}

async function assertBudgetOk() {
  const usage = await getRemoteUsageUsd();
  const remaining = BUDGET_LIMIT_USD - usage;
  if (remaining <= SAFETY_MARGIN_USD) {
    throw new BudgetExceededError(
      `$${usage.toFixed(4)} spent of $${BUDGET_LIMIT_USD.toFixed(2)}, only $${remaining.toFixed(4)} left.`,
    );
  }
  return { usage, remaining };
}

/** Retries a raw network-level failure (DNS blip, connection reset) before
 * giving up — HTTP error responses (4xx/5xx) are NOT retried here, they're
 * returned normally so the caller's own chunk-retry logic handles them. */
async function fetchWithNetworkRetry(url, options) {
  const delays = [1000, 3000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

async function callModel(system, user) {
  const res = await fetchWithNetworkRetry(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://gurukul.app",
      "X-Title": "Gurukul RBSE Question Bank Verifier",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Empty model response");
  return text.trim();
}

function repairControlCharsInStrings(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (inString && !escaped && code >= 0 && code < 0x20) {
      out += ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : ch === "\r" ? "\\r" : " ";
      continue;
    }
    out += ch;
    if (inString && !escaped && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) inString = !inString;
    escaped = false;
  }
  return out;
}

function extractJson(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON array found. First 300 chars: " + t.slice(0, 300));
  }
  const candidate = t.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(repairControlCharsInStrings(candidate));
  }
}

const VERIFY_SYSTEM = `You are an adversarial quality reviewer for an RBSE Commerce MCQ question bank. You did NOT necessarily write these questions — review them skeptically, do not assume they are correct.

For EACH question given (indexed 0, 1, 2, ...), independently verify:
1. If it involves ANY calculation, formula, or numerical answer: re-solve it yourself from scratch, step by step, and compare to the marked correct option. Do not trust the given explanation's arithmetic — redo the math independently.
2. Exactly one option must be unambiguously correct — check the other 3 are genuinely wrong, not just "less good."
3. The explanation must actually be consistent with and support the marked correct answer.
4. No corrupted text, no missing words, no broken punctuation.

Output STRICT JSON ONLY — an array with one object per input question, in the same order, same length as input:
[{"i": 0, "verdict": "ok"}, {"i": 1, "verdict": "wrong_answer", "correct_index": 2, "reason": "short reason"}, {"i": 2, "verdict": "drop", "reason": "short reason"}, ...]

verdict is one of:
- "ok" — question is correct as-is, keep it unchanged.
- "wrong_answer" — the question/options are fine but the marked correct_index is wrong; include the actual correct 0-based index in "correct_index".
- "drop" — the question is ambiguous, corrupted, or too unreliable to fix; drop it entirely (include a short "reason").

No text before or after the JSON array.`;

const VERIFY_SYSTEM_HINDI = `You are an adversarial Hindi-language quality reviewer for an RBSE Hindi MCQ question bank (Devanagari script). You did NOT necessarily write these questions — review them with EXTRA linguistic scrutiny; do not assume they are correct merely because they look readable.

For EACH question given (indexed 0, 1, 2, ...), independently verify, character by character where needed:
1. LANGUAGE INTEGRITY — no corrupted characters, no missing characters, no incorrect Unicode, no mojibake (look specifically for patterns like "à¤" / "à¥" which indicate UTF-8-as-Latin1 corruption), no duplicated characters, no truncated words or sentences, no broken punctuation.
2. MATRAS — every matra (मात्रा) present and correctly placed; no missing matra, no wrong matra, no misplaced matra.
3. CONJUNCTS — every conjunct consonant (संयुक्ताक्षर) correctly formed, no broken half-letters.
4. ANUSVARA / CHANDRABINDU / VISARGA / HALANT — all used correctly where grammatically required, none missing or misapplied.
5. SPELLING — every word correctly spelled per standard Hindi orthography.
6. GRAMMAR — sentence structure is grammatically valid Hindi; the question is genuinely comprehensible to a Class 11/12 RBSE student.
7. MEANING — the question's meaning has not been altered or made ambiguous by any character/spelling error.
8. ANSWER CORRECTNESS — exactly one option is unambiguously correct for the stated grammar rule (sandhi/samaas/vibhakti/kaal/etc.); the explanation genuinely justifies it.
9. If the question concerns a specific literary work, poem, or author, do not invent or guess factual details you are not confident about.

If ANY doubt exists about linguistic correctness — even if the question "looks readable" — treat it as REJECT. Do not approve based on probability ("this is probably the right spelling"). When in doubt, drop it.

Output STRICT JSON ONLY — an array with one object per input question, in the same order, same length as input:
[{"i": 0, "verdict": "ok"}, {"i": 1, "verdict": "wrong_answer", "correct_index": 2, "reason": "short reason"}, {"i": 2, "verdict": "drop", "reason": "short reason, e.g. missing matra in option 3"}, ...]

No text before or after the JSON array.`;

async function verifyChapterBatch(subjectKey, subjectName, classLevel, chapter, items) {
  const numbered = items.map((it, i) => ({ i, q: it.q, o: it.o, c: it.c, e: it.e }));
  const system = subjectKey === "hindi" ? VERIFY_SYSTEM_HINDI : VERIFY_SYSTEM;
  const user = `Subject: ${subjectName}\nClass: ${classLevel}\nChapter: "${chapter}"\n\nVerify these ${items.length} questions:\n${JSON.stringify(numbered)}\n\nReturn the verdict JSON array now.`;
  const raw = await callModel(system, user);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed)) throw new Error("Verify response was not an array");
  return parsed;
}

async function main() {
  const subjectKey = process.argv[2];
  const cacheSubjectDir = path.join(CACHE_DIR, subjectKey);
  if (!fs.existsSync(cacheSubjectDir)) {
    console.error(`No cache dir for subject "${subjectKey}": ${cacheSubjectDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(cacheSubjectDir).filter((f) => f.endsWith(".json") && !f.endsWith(".verified.json"));
  console.log(`=== Verifying ${subjectKey} (${files.length} chapter files) via ${MODEL} ===`);

  let totalQuestions = 0;
  let totalDropped = 0;
  let totalCorrected = 0;
  let budgetStopped = false;
  const CHUNK = 15; // verify in chunks so one bad model response doesn't lose a whole chapter

  outer: for (const f of files) {
    const filePath = path.join(cacheSubjectDir, f);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (data.verified === true) {
      console.log(`[skip, already verified] ${data.classLevel} — ${data.chapter}`);
      totalQuestions += data.items.length;
      continue;
    }
    const items = data.items;
    totalQuestions += items.length;

    const kept = [];
    let dropped = 0;
    let corrected = 0;

    for (let start = 0; start < items.length; start += CHUNK) {
      try {
        await assertBudgetOk();
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          console.log(`\nBUDGET LIMIT REACHED: ${e.message}`);
          // Keep whatever was verified this chapter so far, plus the
          // not-yet-reached remainder UNCHANGED (never silently dropped —
          // "not yet verified" is not the same as "verified and rejected").
          kept.push(...items.slice(start));
          fs.writeFileSync(filePath, JSON.stringify({ ...data, items: kept, verified: false }, null, 2), "utf8");
          console.log(`  -> ${data.chapter}: saved with ${kept.length} items (${start} verified, rest unverified)`);
          budgetStopped = true;
          break outer;
        }
        throw e;
      }
      const chunk = items.slice(start, start + CHUNK);
      process.stdout.write(
        `  ${data.classLevel} — ${data.chapter} [${start + 1}-${start + chunk.length}/${items.length}] ... `,
      );
      try {
        const verdicts = await verifyChapterBatch(subjectKey, data.subject, data.classLevel, data.chapter, chunk);
        const byIndex = new Map(verdicts.map((v) => [v.i, v]));
        let chunkDropped = 0;
        let chunkCorrected = 0;
        for (let i = 0; i < chunk.length; i++) {
          const v = byIndex.get(i);
          if (!v || v.verdict === "ok") {
            kept.push(chunk[i]);
          } else if (v.verdict === "wrong_answer" && typeof v.correct_index === "number") {
            kept.push({ ...chunk[i], c: v.correct_index });
            chunkCorrected++;
          } else {
            chunkDropped++;
          }
        }
        dropped += chunkDropped;
        corrected += chunkCorrected;
        console.log(`OK (${chunkDropped} dropped, ${chunkCorrected} corrected)`);
      } catch (e) {
        console.log(`FAILED (keeping chunk as-is, unverified): ${e.message}`);
        kept.push(...chunk);
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    totalDropped += dropped;
    totalCorrected += corrected;

    fs.writeFileSync(
      filePath,
      JSON.stringify({ ...data, items: kept, verified: true }, null, 2),
      "utf8",
    );
    console.log(`  -> ${data.chapter}: ${items.length} -> ${kept.length} (dropped ${dropped}, corrected ${corrected})`);
  }

  if (budgetStopped) {
    console.log(`\n*** VERIFICATION STOPPED EARLY — BUDGET LIMIT *** (${totalQuestions} checked so far across this run)`);
  } else {
    console.log(
      `\n=== ${subjectKey} verification done: ${totalQuestions} checked, ${totalDropped} dropped, ${totalCorrected} corrected ===`,
    );
  }
}

/** Resumable: unverified/partially-verified files are simply re-processed
 * (chunks already marked verified:true are skipped by re-running only on
 * files still needing it — see the caller's re-run instructions). Auto-
 * restart on any uncaught crash instead of dying, since real progress is
 * saved incrementally per chunk/file already. */
async function runWithAutoRestart() {
  const MAX_RESTARTS = 15;
  for (let attempt = 1; attempt <= MAX_RESTARTS; attempt++) {
    try {
      await main();
      return;
    } catch (e) {
      console.error(`\nCRASHED (attempt ${attempt}/${MAX_RESTARTS}): ${e.message}`);
      if (attempt >= MAX_RESTARTS) {
        console.error("Giving up after max restarts. Everything verified so far is saved.");
        process.exit(1);
      }
      const delay = Math.min(30000, 2000 * attempt);
      console.error(`Restarting in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

runWithAutoRestart();
