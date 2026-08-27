/**
 * Re-run every chunk verification file and classify the outcome.
 *
 * G11: "This rule applies to your own tooling. A verification runner that
 * misreports is the same defect class. Classify on structural signals —
 * SQLSTATE, exit codes — never on matching report wording."
 *
 * Every verification file ends in a deliberate `RAISE EXCEPTION` carrying its
 * report, so that the whole transaction rolls back. That RAISE is SQLSTATE
 * P0001. So:
 *
 *   P0001            -> the file executed to completion and produced its report.
 *                       ONLY THEN is the report text meaningful.
 *   any other state  -> the file could not execute. It has rotted against the
 *                       current schema and is no longer verifying anything.
 *   no error at all  -> the file did not RAISE. It is either vacuous or was
 *                       written without the rollback convention; flagged, not
 *                       assumed passing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations/verification";
const REF = "psqxykzqfvxgsvkmgurn";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

async function run(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  return res.json();
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
let rotted = 0;
let failed = 0;
let vacuous = 0;

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  const out = await run(sql);
  const msg = typeof out?.message === "string" ? out.message : null;
  const name = f.replace(/\.sql$/, "");

  if (!msg) {
    // No error: the file returned rows instead of raising its report.
    vacuous++;
    console.log(`VACUOUS?  ${name}  — did not RAISE; verifies nothing unless it asserts in SQL`);
    continue;
  }

  // Structural signal: the SQLSTATE immediately following "ERROR:  ".
  const m = msg.match(/ERROR:\s+([0-9A-Z]{5}):/);
  const sqlstate = m ? m[1] : null;

  if (sqlstate !== "P0001") {
    rotted++;
    const detail = msg.replace(/\s+/g, " ").slice(0, 120);
    console.log(`ROTTED    ${name}  — SQLSTATE ${sqlstate ?? "?"} :: ${detail}`);
    continue;
  }

  // Only now does the report text mean anything.
  if (/\bFAIL\b/.test(msg)) {
    failed++;
    // This split on a LITERAL backslash-n, which never matches: the JSON has
    // already been parsed, so the message carries real newlines. Nothing was
    // split, the filter returned the entire message as one "line", and the
    // report printed its first 150 characters — hiding which item failed
    // behind whatever happened to come first. A runner that cannot say what
    // failed is the same defect class it exists to catch.
    const lines = msg.split(/\r?\n/).filter((l) => /\bFAIL\b/.test(l));
    console.log(`FAIL      ${name}`);
    for (const l of lines) console.log(`            ${l.trim().slice(0, 200)}`);
  } else {
    console.log(`OK        ${name}`);
  }
}

console.log(
  `\n${files.length} file(s): ${files.length - rotted - failed - vacuous} ok, ` +
    `${failed} reporting FAIL, ${rotted} rotted, ${vacuous} raising nothing.`,
);
process.exit(rotted + failed + vacuous === 0 ? 0 : 1);
