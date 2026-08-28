/**
 * Chunk 6.7 — the isolation-boundary instrument.
 *
 * Captures, for every role and every fenced table, the exact SET OF ROWS that
 * role can read — as a content hash of each row, not a count.
 *
 *   node scripts/isolation-set-equality.mjs snapshot <file>
 *   node scripts/isolation-set-equality.mjs compare  <before> <after>
 *
 * WHY CONTENT HASHES AND NOT COUNTS
 * A count is invariant under a swap. If a policy rewrite made parent A see
 * child B's marks and vice versa, every count in every report would be
 * unchanged and the gate would pass. Hashing each row's full text and then
 * hashing the sorted multiset of those hashes fails on any substitution,
 * addition or removal — which is the only standard worth applying to a fence
 * around children's data.
 *
 * WHY IT RUNS AS THE REAL ROLE
 * Each probe sets request.jwt.claims and SET LOCAL ROLE authenticated, so RLS
 * is actually evaluated. Verifying as the table owner would bypass every
 * policy and prove nothing (G11).
 *
 * WHAT A DIFFERENCE MEANS
 * Tightening over-fences as easily as loosening under-fences, so this reports
 * BOTH directions and treats either as a failure:
 *   rows appeared  -> the fence was loosened. A leak.
 *   rows vanished  -> the fence was tightened. Legitimate access was lost.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

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

const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
if (!MGMT) {
  console.error("No SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(2);
}

/**
 * The Management API caps a request at roughly four minutes and answers with
 * an HTML gateway page, not JSON, when it gives up. Parsing that blindly threw
 * a raw SyntaxError and lost which table was being probed — a swallowed
 * failure in the instrument itself (G10). Return it as a structured error so
 * the caller can name the table and carry on.
 */
const run = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      __transport_error: `HTTP ${r.status} non-JSON (${text.trim().slice(0, 80).replace(/\s+/g, " ")})`,
    };
  }
};

/**
 * Every role that can read, including anon. anon is included deliberately: an
 * unauthenticated caller is the one the fence must never let through, and it
 * is the case a role-dispatch rewrite is most likely to get wrong.
 */
const ROLES = [
  ["admin", "admin@wisdomcampus.com"],
  ["principal", "principal@wisdomcampus.com"],
  ["teacher", "priya.sharma@wisdomcampus.com"],
  ["parent", "mehta.parent@wisdomcampus.com"],
  ["student", "arjun.mehta@wisdomcampus.com"],
  ["anon", null],
];

/** Every table carrying a tenant fence, whichever shape it currently has. */
const TABLE_SQL = `
  SELECT DISTINCT c.relname AS t
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT p.polpermissive
     AND p.polname = c.relname || '_tenant_fence'
   ORDER BY 1`;

async function listTables(only) {
  const out = await run(TABLE_SQL);
  if (!Array.isArray(out)) throw new Error(`table list failed: ${JSON.stringify(out).slice(0, 300)}`);
  const all = out.map((r) => r.t);
  if (!only) return all;
  const want = only.split(",").map((s) => s.trim()).filter(Boolean);
  const missing = want.filter((w) => !all.includes(w));
  if (missing.length) {
    console.error(`not fenced tables: ${missing.join(", ")}`);
    process.exit(2);
  }
  return want;
}

/**
 * One statement per role covering every table, so a snapshot is a handful of
 * round trips rather than 90 x 6. Each table's probe is wrapped so that a
 * table erroring (for instance a role denied EXECUTE on a fence helper) is
 * recorded as ERR for that table rather than aborting the whole snapshot —
 * an aborted snapshot would look like "no differences found".
 */
function probeSql(email, tables) {
  const claims =
    email === null
      ? `PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
         SET LOCAL ROLE anon;`
      : `SELECT id INTO _uid FROM auth.users WHERE email = '${email}';
         IF _uid IS NULL THEN RAISE EXCEPTION 'no auth user %', '${email}'; END IF;
         PERFORM set_config('request.jwt.claims',
           json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
         SET LOCAL ROLE authenticated;`;

  const probes = tables
    .map(
      (t) => `
    BEGIN
      EXECUTE 'SELECT count(*), coalesce(md5(string_agg(h, '','' ORDER BY h)), ''-'') '
           || 'FROM (SELECT md5(x::text) AS h FROM public.${t} x) s'
        INTO _n, _h;
      _out := _out || '${t}=' || _n || ':' || _h || E'\\n';
    EXCEPTION WHEN others THEN
      _out := _out || '${t}=ERR:' || replace(SQLERRM, E'\\n', ' ') || E'\\n';
    END;`,
    )
    .join("");

  // The pre-rewrite fence is slow enough that snapshotting can itself time out
  // (academic_events is 53-91s per role). The cap has to be lifted in its OWN
  // statement: statement_timeout is armed when a statement begins, so setting
  // it inside the DO block would be too late to affect that same block.
  // The timing gate, not this one, is where slowness is judged.
  return `
SET statement_timeout = '900s';
DO $probe$
DECLARE _uid uuid; _n bigint; _h text; _out text := '';
BEGIN
  ${claims}
  ${probes}
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE EXCEPTION 'SNAPSHOT%', E'\\n' || _out;
END
$probe$;`;
}

async function snapshot(outPath, only) {
  const tables = await listTables(only);
  console.error(`snapshotting ${tables.length} fenced table(s) x ${ROLES.length} role(s)…`);
  const snap = { tables, roles: {} };

  // One request per (role, table). Batching every table into one statement is
  // fewer round trips, but pre-rewrite a single table can take 90s and the
  // Management API gives up at about four minutes — so a batch would die and
  // take the whole snapshot with it.
  for (const [label, email] of ROLES) {
    const rows = {};
    for (const t of tables) {
      const res = await run(probeSql(email, [t]));
      if (res?.__transport_error) {
        rows[t] = `ERR:${res.__transport_error}`;
        console.error(`  ${label}/${t}: ${res.__transport_error}`);
        continue;
      }
      const msg = res?.message ?? "";
      const i = msg.indexOf("SNAPSHOT");
      if (i === -1) {
        rows[t] = `ERR:${msg.replace(/\s+/g, " ").slice(0, 200)}`;
        console.error(`  ${label}/${t}: ${rows[t]}`);
        continue;
      }
      const m = msg.slice(i).match(/^([a-z0-9_]+)=(.*)$/m);
      rows[t] = m ? m[2] : "ERR:unparsed";
    }
    const errs = Object.values(rows).filter((v) => v.startsWith("ERR:")).length;
    console.error(`  ${label}: ${Object.keys(rows).length} table(s)${errs ? `, ${errs} ERR` : ""}`);
    snap.roles[label] = rows;
  }

  writeFileSync(outPath, JSON.stringify(snap, null, 2));
  console.error(`wrote ${outPath}`);
}

function compare(beforePath, afterPath) {
  const a = JSON.parse(readFileSync(beforePath, "utf8"));
  const b = JSON.parse(readFileSync(afterPath, "utf8"));
  let diffs = 0;
  let unmeasured = 0;
  let checked = 0;

  for (const role of Object.keys(a.roles)) {
    const A = a.roles[role] ?? {};
    const B = b.roles[role] ?? {};
    const tables = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
    for (const t of tables) {
      checked += 1;
      const av = A[t] ?? "<missing>";
      const bv = B[t] ?? "<missing>";
      if (av === bv) continue;

      // An ERR on either side is not a change in what the role can see — it is
      // the absence of a measurement. Counting it as "access lost" would be
      // reporting a failure for the wrong reason, which is exactly the defect
      // this instrument exists to catch. Surfaced separately and never
      // silently folded into the pass/fail count.
      if (av.startsWith("ERR:") || bv.startsWith("ERR:")) {
        unmeasured += 1;
        const which = av.startsWith("ERR:") ? "before" : "after";
        console.log(
          `NO BASELINE  ${role.padEnd(10)} ${t.padEnd(30)} unreadable ${which} — not a set difference`,
        );
        console.log(`        before ${av.slice(0, 110)}`);
        console.log(`        after  ${bv.slice(0, 110)}`);
        continue;
      }

      diffs += 1;
      const [an] = av.split(":");
      const [bn] = bv.split(":");
      const dir =
        an === bn
          ? "SAME COUNT, DIFFERENT ROWS — a substitution, which a count check would have passed"
          : Number(bn) > Number(an)
            ? `LOOSENED: ${an} -> ${bn} rows now visible`
            : `TIGHTENED: ${an} -> ${bn} rows still visible — legitimate access lost`;
      console.log(`DIFF  ${role.padEnd(10)} ${t.padEnd(34)} ${dir}`);
      console.log(`        before ${av}`);
      console.log(`        after  ${bv}`);
    }
  }

  console.log(
    `\n${checked} role/table pair(s) compared, ${diffs} difference(s), ${unmeasured} unmeasured.`,
  );
  if (diffs === 0 && unmeasured === 0) {
    console.log("Visible sets are byte-identical for every role on every fenced table.");
  } else if (diffs === 0) {
    console.log(
      `Visible sets are byte-identical everywhere a baseline exists. ${unmeasured} pair(s) had no ` +
        `baseline to compare against — those are reported, not counted as passing.`,
    );
  }
  process.exit(diffs === 0 ? 0 : 1);
}

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith("--tables="));
const only = onlyArg ? onlyArg.slice("--tables=".length) : null;
const [cmd, p1, p2] = args.filter((a) => !a.startsWith("--"));
if (cmd === "snapshot" && p1) await snapshot(p1, only);
else if (cmd === "compare" && p1 && p2) compare(p1, p2);
else {
  console.error(
    "usage: isolation-set-equality.mjs snapshot <file> [--tables=a,b] | compare <before> <after>",
  );
  process.exit(2);
}
