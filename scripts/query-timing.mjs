/**
 * G12 timing gate — the heaviest realistic query per touched table, per role.
 *
 * "A policy that times out is a broken feature." Anything within 2x of the
 * statement timeout is a finding, not a footnote.
 *
 *   authenticated  statement_timeout = 8s   -> finding at >= 4000 ms
 *   anon           statement_timeout = 3s   -> finding at >= 1500 ms
 *
 * Timing is taken INSIDE the database (clock_timestamp around the query) so it
 * measures the policy stack, not the round trip to the Management API.
 *
 * Usage: node scripts/query-timing.mjs <table> [<table> ...]
 *        node scripts/query-timing.mjs            (defaults to Chunk 6's tables)
 */
import { readFileSync } from "node:fs";

const REF = "psqxykzqfvxgsvkmgurn";
const TIMEOUT_MS = 8000;             // authenticated
const FINDING_AT = TIMEOUT_MS / 2;   // within 2x of the timeout

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

const tables = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["tests", "test_marks", "exams", "exam_subjects", "marks", "report_cards"];

let findings = 0;
console.log(`statement_timeout ${TIMEOUT_MS}ms — finding at >= ${FINDING_AT}ms\n`);

for (const table of tables) {
  const cells = [];
  for (const [label, email] of ROLES) {
    // A full scan is the heaviest realistic read: it forces the policy stack
    // over every candidate row, which is precisely what nested RLS multiplies.
    const sql = `
      DO $$
      DECLARE _uid uuid; _t0 timestamptz; _ms numeric; _n bigint;
      BEGIN
        SELECT id INTO _uid FROM auth.users WHERE email = '${email}';
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        _t0 := clock_timestamp();
        SELECT count(*) INTO _n FROM public.${table};
        _ms := EXTRACT(EPOCH FROM (clock_timestamp() - _t0)) * 1000;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'TIMING % rows=%', round(_ms, 1), _n;
      END $$;`;
    const out = await run(sql);
    const m = (out?.message ?? "").match(/TIMING ([\d.]+) rows=(\d+)/);
    if (!m) { cells.push(`${label}=ERR`); continue; }
    const ms = parseFloat(m[1]);
    const flag = ms >= FINDING_AT ? " **FINDING**" : "";
    if (ms >= FINDING_AT) findings++;
    cells.push(`${label}=${ms}ms/${m[2]}r${flag}`);
  }
  console.log(`${table.padEnd(15)} ${cells.join("  ")}`);
}

console.log(`\n${findings} finding(s) within 2x of the statement timeout.`);
process.exit(findings === 0 ? 0 : 1);
