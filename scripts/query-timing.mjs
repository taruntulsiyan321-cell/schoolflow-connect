/**
 * G12 timing gate — the heaviest realistic query per touched table, per role.
 *
 * "A policy that times out is a broken feature." Anything within 2x of the
 * statement timeout is a finding, not a footnote.
 *
 *   authenticated  statement_timeout = 8s   -> finding at >= 4000 ms
 *
 * Timing is taken INSIDE the database so it measures the policy stack, not the
 * round trip to the Management API.
 *
 * WHY THIS READS THE PLAN INSTEAD OF A STOPWATCH
 *
 * G12 asks for per-row cost and what it becomes at scale, and a single total
 * cannot give you that: a policy whose setup costs 900 ms once and a policy
 * that costs 25 ms per row look identical at 36 rows and could not be less
 * alike at 10,000. Both were live in this codebase at the same time.
 *
 * Two wrong ways were tried before this one, and are recorded so they are not
 * tried again:
 *
 *   1. total / candidates. On a 36-row table almost all the time is one-time
 *      setup, so this invented a 25 ms/row figure and projected 250 s.
 *   2. Subtracting a ctid-restricted scan to isolate setup. SubPlans are
 *      evaluated LAZILY, so restricting to one row can skip them entirely and
 *      report 1.4 ms of setup for a policy whose setup really costs 27 ms.
 *
 * EXPLAIN (ANALYZE) reports each SubPlan/InitPlan node separately, so setup
 * and per-row work can simply be read off rather than inferred.
 *
 * A caveat this gate cannot remove, and states rather than hides: "once per
 * statement" is not the same as "constant". A helper that scans a table to
 * build its set still grows with that table — the cost stops multiplying, it
 * does not stop existing.
 *
 * Usage: node scripts/query-timing.mjs <table> [<table> ...]
 *        node scripts/query-timing.mjs            (defaults to Chunk 6's tables)
 */
import { readFileSync } from "node:fs";

const REF = "psqxykzqfvxgsvkmgurn";
const TIMEOUT_MS = 8000;             // authenticated
const FINDING_AT = TIMEOUT_MS / 2;   // within 2x of the timeout
const MEASURE_TIMEOUT = "180s";      // headroom to measure, not to permit
const PROJECT_TO = 10000;

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);

const run = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return r.json();
};

const ROLES = [
  ["admin", "admin@wisdomcampus.com"],
  ["principal", "principal@wisdomcampus.com"],
  ["teacher", "priya.sharma@wisdomcampus.com"],
  ["parent", "mehta.parent@wisdomcampus.com"],
  ["student", "arjun.mehta@wisdomcampus.com"],
];

const explainSql = (email, table) => `
  DO $$
  DECLARE _uid uuid; _line text; _out text := '';
  BEGIN
    SELECT id INTO _uid FROM auth.users WHERE email = '${email}';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SET LOCAL statement_timeout = '${MEASURE_TIMEOUT}';
    FOR _line IN EXECUTE 'EXPLAIN (ANALYZE) SELECT count(*) FROM public.${table}' LOOP
      _out := _out || _line || E'\\n';
    END LOOP;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '%', _out;
  END $$;`;

/** Sum every SubPlan/InitPlan node: the work done once per statement. */
function splitPlan(plan, table) {
  let fixed = 0;
  let inSub = false;
  for (const line of plan.split("\n")) {
    if (/^\s*(Sub|Init)Plan\b/.test(line)) { inSub = true; continue; }
    if (!inSub) continue;
    const m = line.match(/actual time=[\d.]+\.\.([\d.]+) rows=\d+ loops=(\d+)/);
    if (m) { fixed += parseFloat(m[1]) * Number(m[2]); inSub = false; }
    else if (/never executed/.test(line)) { inSub = false; }
  }
  const totalM = plan.match(/Execution Time: ([\d.]+) ms/);
  const removedM = plan.match(/Rows Removed by Filter: (\d+)/);
  // Two fixes, both from figures this gate printed confidently and wrongly.
  //
  // "Index Only Scan" was missing, so attendance_audit reported 0 rows scanned
  // and 0.0000ms per row — a number that reads like a pass but is absent.
  //
  // And the scan node must be the one ON THE TABLE BEING MEASURED. Unanchored,
  // this matched whichever scan came first in the plan: on question_bank as a
  // parent it picked up the `schools` lookup, reported "2 rows scanned", and
  // turned a 33ms query into a projected 65s. There are exactly two schools.
  const scanM = plan.match(
    new RegExp(`(?:Seq Scan|Index Only Scan|Index Scan|Bitmap Heap Scan) on ${table}\\b[^\\n]*rows=(\\d+) loops=\\d+`),
  );
  const total = totalM ? parseFloat(totalM[1]) : null;
  const scanned = (removedM ? Number(removedM[1]) : 0) + (scanM ? Number(scanM[1]) : 0);
  return { total, fixed, scanned };
}

const tables = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["tests", "test_marks", "exams", "exam_subjects", "marks", "report_cards"];

let findings = 0;
let projected = 0;
console.log(`statement_timeout ${TIMEOUT_MS}ms — finding at >= ${FINDING_AT}ms`);
console.log(`setup vs per-row read from EXPLAIN (ANALYZE); projected to ${PROJECT_TO.toLocaleString()} rows\n`);

for (const table of tables) {
  const totalOut = await run(`SELECT count(*)::bigint AS n FROM public.${table};`);
  const candidates = Number(totalOut?.[0]?.n ?? 0);
  console.log(`${table}  (${candidates.toLocaleString()} row(s) in the table)`);

  for (const [label, email] of ROLES) {
    const out = await run(explainSql(email, table));
    const raw = (out?.message ?? "");
    const plan = raw.replace(/^.*?P0001:\s*/s, "").replace(/\nCONTEXT:[\s\S]*$/, "");
    const { total, fixed, scanned } = splitPlan(plan, table);

    if (total === null) {
      // A gate that cannot run must FAIL, not skip.
      console.log(`  ${label.padEnd(10)} ERROR :: ${raw.replace(/\s+/g, " ").slice(0, 110)}`);
      findings++;
      continue;
    }
    const perRow = scanned ? Math.max(0, total - fixed) / scanned : 0;
    const at10k = fixed + perRow * PROJECT_TO;

    const overNow = total >= FINDING_AT;
    const overLater = at10k >= FINDING_AT;
    if (overNow) findings++;
    else if (overLater) projected++;

    const flag = overNow ? "  **FINDING**" : overLater ? "  (projects over)" : "";
    console.log(
      `  ${label.padEnd(10)} ${total.toFixed(1).padStart(8)}ms  =  ${fixed.toFixed(1).padStart(7)}ms setup  +  ` +
      `${perRow.toFixed(4)}ms x ${String(scanned).padStart(5)} rows  ->  ${(at10k / 1000).toFixed(2)}s at ${PROJECT_TO.toLocaleString()}${flag}`,
    );
  }
  console.log();
}

console.log(`${findings} finding(s) at current volume.`);
console.log(`${projected} path(s) under the gate today that exceed it at ${PROJECT_TO.toLocaleString()} rows.`);
process.exit(findings === 0 && projected === 0 ? 0 : 1);
