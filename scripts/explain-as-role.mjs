/**
 * EXPLAIN (ANALYZE) a full scan of one table as one seeded role.
 *
 * Exists because a single wall-clock number cannot tell you WHY a policy is
 * slow, and the two wrong answers look identical from outside: a policy whose
 * setup is expensive once, and a policy that is cheap but paid per row. The
 * first is harmless at scale; the second is the HTTP 500 next term.
 *
 * An earlier attempt to separate them by timing a ctid-restricted scan was
 * itself wrong, and is recorded here so it is not tried again: SubPlans are
 * evaluated LAZILY, so restricting the scan to one row can skip them entirely
 * and report a fixed cost of ~1 ms for a policy whose setup actually costs
 * 27 ms. The plan is the only honest source.
 *
 * Usage: node scripts/explain-as-role.mjs <table> [role]
 */
import { readFileSync } from "node:fs";

const REF = "psqxykzqfvxgsvkmgurn";
const ROLES = {
  admin: "admin@wisdomcampus.com",
  principal: "principal@wisdomcampus.com",
  teacher: "priya.sharma@wisdomcampus.com",
  parent: "mehta.parent@wisdomcampus.com",
  student: "arjun.mehta@wisdomcampus.com",
};

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);

const table = process.argv[2];
const role = process.argv[3] ?? "parent";
if (!table || !ROLES[role]) {
  console.error(`usage: node scripts/explain-as-role.mjs <table> [${Object.keys(ROLES).join("|")}]`);
  process.exit(2);
}

const sql = `
  DO $$
  DECLARE _uid uuid; _line text; _out text := '';
  BEGIN
    SELECT id INTO _uid FROM auth.users WHERE email = '${ROLES[role]}';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SET LOCAL statement_timeout = '180s';
    FOR _line IN EXECUTE 'EXPLAIN (ANALYZE) SELECT count(*) FROM public.${table}' LOOP
      _out := _out || _line || E'\\n';
    END LOOP;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION '%', _out;
  END $$;`;

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const out = await res.json();
const plan = (out?.message ?? "").replace(/^.*?P0001:\s*/s, "").replace(/\nCONTEXT:[\s\S]*$/, "");
console.log(plan);

// Sum the SubPlan / InitPlan nodes: that is the once-per-statement setup.
// Everything else is what grows with rows.
let fixed = 0;
let inSub = false;
for (const line of plan.split("\n")) {
  if (/^\s*(Sub|Init)Plan\b/.test(line)) { inSub = true; continue; }
  if (inSub) {
    const m = line.match(/actual time=[\d.]+\.\.([\d.]+) rows=\d+ loops=(\d+)/);
    if (m) { fixed += parseFloat(m[1]) * Number(m[2]); inSub = false; }
    else if (/never executed/.test(line)) { inSub = false; }
  }
}
const totalM = plan.match(/Execution Time: ([\d.]+) ms/);
const rowsM  = plan.match(/Rows Removed by Filter: (\d+)/);
const outM   = plan.match(/Seq Scan on \w+.*rows=(\d+) loops/);
const total  = totalM ? parseFloat(totalM[1]) : 0;
const scanned = (rowsM ? Number(rowsM[1]) : 0) + (outM ? Number(outM[1]) : 0);

console.log(`\n--- ${table} as ${role} ---`);
console.log(`rows scanned      ${scanned}`);
console.log(`total             ${total.toFixed(1)} ms`);
console.log(`once-per-statement ${fixed.toFixed(1)} ms   (SubPlan/InitPlan setup)`);
console.log(`per row           ${scanned ? ((total - fixed) / scanned).toFixed(4) : "n/a"} ms`);
console.log(`at 10,000 rows    ${((fixed + (scanned ? (total - fixed) / scanned : 0) * 10000) / 1000).toFixed(2)} s`);
