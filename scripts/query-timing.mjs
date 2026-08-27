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

/**
 * Scales the per-row cost is projected to. The demo school is tiny, so a total
 * that looks fine here says almost nothing about a real institution: what
 * matters is the MARGINAL cost of one more row, which a 5-row table hides
 * inside its fixed setup cost.
 */
const PROJECT_TO = [200, 2000];

/**
 * Time the policy stack over exactly `limit` rows of `table`, as `email`.
 * LIMIT is applied INSIDE the scan, so the policy is evaluated for that many
 * candidate rows and no more. Runs twice and keeps the second, so plan and
 * catalogue warm-up is not counted as query cost.
 */
const timeAt = async (table, email) => {
  const sql = `
    DO $$
    DECLARE _uid uuid; _t0 timestamptz; _ms numeric; _n bigint; _cand bigint;
    BEGIN
      -- Candidate rows: what the policy is actually EVALUATED against.
      -- Counted before the role switch, so RLS does not hide any of them.
      SELECT count(*) INTO _cand FROM public.${table};

      SELECT id INTO _uid FROM auth.users WHERE email = '${email}';
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO _n FROM public.${table};       -- warm
      _t0 := clock_timestamp();
      SELECT count(*) INTO _n FROM public.${table};
      _ms := EXTRACT(EPOCH FROM (clock_timestamp() - _t0)) * 1000;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION 'TIMING % visible=% candidates=%', round(_ms, 1), _n, _cand;
    END $$;`;
  const out = await run(sql);
  const m = (out?.message ?? "").match(/TIMING ([\d.]+) visible=(\d+) candidates=(\d+)/);
  return m
    ? { ms: parseFloat(m[1]), visible: parseInt(m[2], 10), candidates: parseInt(m[3], 10) }
    : null;
};

let findings = 0;
let projected = 0;

console.log(`statement_timeout ${TIMEOUT_MS}ms — finding at >= ${FINDING_AT}ms`);
console.log(
  "cost is per CANDIDATE row — the rows the policy is evaluated against, not the rows it lets through.",
);
console.log(
  "Dividing by visible rows instead overstates it by the selectivity of the policy (marks/parent: 26 candidates, 5 visible = 5x).",
);
console.log(
  "Fixed setup is included, so this is an upper bound at these sizes; the projection carries it forward unchanged.\n",
);

for (const table of tables) {
  for (const [label, email] of ROLES) {
    const r = await timeAt(table, email);
    if (!r) {
      console.log(`${table.padEnd(14)} ${label.padEnd(10)} ERR`);
      continue;
    }
    const flag = r.ms >= FINDING_AT ? "  **FINDING**" : "";
    if (r.ms >= FINDING_AT) findings++;

    const perCandidate = r.candidates > 0 ? r.ms / r.candidates : null;
    const proj =
      perCandidate == null
        ? ""
        : PROJECT_TO.map((n) => {
            const est = perCandidate * n;
            const over = est >= FINDING_AT;
            if (over) projected++;
            return `${n}r~${(est / 1000).toFixed(1)}s${over ? "!" : ""}`;
          }).join(" ");

    console.log(
      `${table.padEnd(14)} ${label.padEnd(10)} ${String(r.ms).padStart(7)}ms  ` +
        `${String(r.visible).padStart(3)} of ${String(r.candidates).padStart(3)} rows   ` +
        `per-candidate: ${perCandidate == null ? "?" : perCandidate.toFixed(2) + "ms"}   proj ${proj}${flag}`,
    );
  }
  console.log("");
}

console.log(`${findings} finding(s) at the measured size.`);
console.log(
  `${projected} projection(s) reaching the finding threshold at ${PROJECT_TO.join("/")} rows — marked with !`,
);
console.log(
  projected > 0
    ? "A projection over the line is a finding about the shape, not the data: the demo school is simply too small to show it yet."
    : "No shape reaches the threshold at projected scale.",
);
process.exit(findings === 0 ? 0 : 1);
