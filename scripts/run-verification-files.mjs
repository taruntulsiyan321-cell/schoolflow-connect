/**
 * G8 + G11: re-run every prior chunk's verification file and report any that no
 * longer execute.
 *
 * "Verification files rot. A schema change can make one unrunnable or silently
 * vacuous." That is exactly how the CHUNK4_VERIFY item 7 problem hid -- the file
 * had been failing to run since Chunk 4.6 removed attendance.class_id, so nobody
 * saw that its item 7 had also been proving nothing.
 *
 * Every verification file ends in a deliberate RAISE so its fixtures roll back.
 * That means "failed with our own report text" IS success, and any other error
 * -- a missing column, a renamed table -- means the file has rotted.
 *
 * A file is judged:
 *   RAN      the deliberate abort fired and the report says every check passed
 *   FAILED   the deliberate abort fired but the report contains a failure
 *   ROTTED   it died on something else: it no longer executes at all
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const PROJECT_REF = process.env.PROJECT_REF || process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DIR = "supabase/migrations/verification";

if (!TOKEN) {
  console.error("No SUPABASE_ACCESS_TOKEN. Put it in .env.local.");
  process.exit(2);
}

async function runSql(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  return { ok: res.ok, text: await res.text() };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const results = [];

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  const { ok, text } = await runSql(sql);

  // A verification file that succeeds HTTP-wise never aborted, which means it
  // did not reach its own RAISE -- it is vacuous.
  if (ok) {
    results.push({ f, state: "ROTTED", why: "completed without reaching its deliberate abort (vacuous)" });
    continue;
  }

  // Classify on the SQLSTATE, never on the report's wording. P0001 is
  // raise_exception -- the file reached its own deliberate abort, so it ran.
  // Any other code (42703 undefined_column, 42P01 undefined_table, ...) means
  // it died on the schema and no longer executes.
  //
  // An earlier version of this matched on a "=====" banner, which the files do
  // not share, and reported three healthy files as rotted. G11 applies to this
  // runner too: it must report for the reason it claims.
  const code = (text.match(/ERROR:\s*([0-9A-Z]{5}):/) || [])[1];
  if (code !== "P0001") {
    const m = text.match(/ERROR:\s*[0-9A-Z]{5}:\s*(.{0,120})/);
    results.push({
      f,
      state: "ROTTED",
      why: `${code || "?"} ${(m ? m[1] : "").replace(/\\n/g, " ").trim()}`,
    });
    continue;
  }

  // Within our own report, a failure announces itself explicitly. Matching a
  // bare "FAIL" would hit the word inside an unused conditional branch.
  // Widened after CHUNK8_BATCH1A_VERIFY reported a real FAIL and this runner
  // announced "0 reported a failure". That file closes with "ONE OR MORE CHECKS
  // FAILED"; the old pattern wanted "CHECK FAILED" (no S) and "AT LEAST ONE",
  // so the one file using that wording could not be failed by the gate that
  // runs it. Second time this predicate has been wrong — see the note above.
  //
  // "FAIL" followed by the two spaces every report uses is matched directly
  // now, rather than trusting each file to close with a banner this list knows.
  const failed = /AT LEAST ONE|CHECKS? FAILED|\(FAIL\)|FAIL {2}/.test(text);
  results.push({ f, state: failed ? "FAILED" : "RAN", why: "" });
}

const w = Math.max(...results.map((r) => r.f.length));
for (const r of results) {
  console.log(`${r.state.padEnd(7)} ${r.f.padEnd(w)}  ${r.why}`);
}

const bad = results.filter((r) => r.state !== "RAN");
console.log(
  `\n${results.length} verification file(s): ` +
    `${results.filter((r) => r.state === "RAN").length} ran clean, ` +
    `${results.filter((r) => r.state === "FAILED").length} reported a failure, ` +
    `${results.filter((r) => r.state === "ROTTED").length} rotted.`,
);
process.exit(bad.length === 0 ? 0 : 1);
