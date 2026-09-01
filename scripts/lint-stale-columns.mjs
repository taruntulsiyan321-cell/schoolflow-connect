/**
 * G15 late binding — find `alias.column` references to columns that do not exist.
 *
 *   node scripts/lint-stale-columns.mjs
 *   node scripts/lint-stale-columns.mjs --self-test    # prove it can fail
 *   node scripts/lint-stale-columns.mjs --show-skipped # what it could not check
 *
 * WHY THIS EXISTS
 * plpgsql resolves column references at EXECUTION, not at definition. A
 * migration that drops or renames a column does not break the bodies referencing
 * it: they compile, CREATE OR REPLACE succeeds, every gate passes, and the
 * failure waits for the first real user.
 *
 * Chunk 7.5c repointed four functions from `dpps` to `tests` and changed the
 * table without changing the columns. `tests` has `status` and `published_at`,
 * not `is_published`. The student dashboard threw on every load — along with the
 * leaderboard, the principal health brief and the homework publisher — for days.
 * The chunk's own verification swept for the string `dpp`, found none, and
 * passed, because the bodies now said `tests`.
 *
 * A sweep for the old TABLE name cannot find a stale COLUMN name. This asks the
 * other question.
 *
 * WHAT IT WILL AND WILL NOT CLAIM
 * It reports a finding only where BOTH facts are certain: the alias resolves to
 * a real table, and the column definitively does not exist on it. Everything
 * else — a CTE, a record variable, an unresolvable alias, NEW/OLD in a trigger —
 * is counted and reported as NOT CHECKED rather than passed. A parser that
 * quietly skips what it cannot understand is the same failure as a sweep that
 * looks for the wrong string: it reports clean because it did not look.
 */
import { queryRows, describeConnection, closeConnection } from "./lib/readonly-db.mjs";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const SHOW_SKIPPED = argv.includes("--show-skipped");

// --scope <table,table,…>  restrict to function bodies that mention any of them,
//                          and attribute the NOT-CHECKED count per function
//                          instead of as one global number.
//
// A global "2,280 not checkable" is an honest scope statement and a useless one
// for deciding whether a particular area is covered. Scoped, the same number
// becomes answerable: these are the functions in this area, and this is exactly
// where the gate stops looking inside them.
//
// --dropped <table,…>      additionally flag aliases bound to a table that no
//                          longer exists. Those resolve to nothing, so they fall
//                          into NOT CHECKED and are invisible in the default run
//                          — which is the wrong place for a reference that will
//                          throw 42P01 on the first call.
const listArg = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0 || !argv[i + 1]) return null;
  return argv[i + 1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
};
const SCOPE = listArg("--scope");
const DROPPED = listArg("--dropped");

// ── Parsing ────────────────────────────────────────────────────────────────

/** Remove comments and string/dollar-quoted literals so `x.y` inside them is not read as a reference. */
function stripNoise(sql) {
  let s = sql;
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/--[^\n]*/g, " ");
  // Dollar-quoted blocks nested inside the body (e.g. an inner $q$...$q$).
  s = s.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, " ");
  s = s.replace(/'(?:[^']|'')*'/g, " ");
  return s;
}

/** The body between the outer dollar quotes of a CREATE FUNCTION definition. */
function bodyOf(def) {
  const m = def.match(/\$([A-Za-z_]\w*)\$([\s\S]*)\$\1\$/);
  return m ? m[2] : def;
}

/**
 * Names that look like an alias but are not a table reference. Each is a place
 * this gate deliberately stops, and each is counted so "clean" never means
 * "there was nothing I could read".
 */
export function cteNames(body) {
  const names = new Set();
  for (const m of body.matchAll(/(?:\bWITH\b|,)\s+([A-Za-z_]\w*)\s+AS\s*(?:MATERIALIZED\s*)?\(/gi))
    names.add(m[1].toLowerCase());
  return names;
}

/**
 * Two sets, not one, and the split is the point.
 *
 *   observed    names this body DECLARES, loops over, or defines as a CTE. Not
 *               column references, established from the body itself.
 *   assumed     names taken on convention — `rec`, `r`, `row`. A real table
 *               alias called `r` disappears into this set, so it is reported as
 *               a place the gate stopped, not as a construct it understood.
 *
 * Collapsing the two would let an assumption count as knowledge. process_academic_event
 * has 160 unreadable references across `e`, `da` and `r`, and whether that is
 * three record variables or three unbound table aliases is exactly the question
 * a single "not checkable" number cannot answer.
 */
function unresolvableNames(body) {
  const observed = new Set(["new", "old", "tg_argv", "tg_table_name", "excluded"]);
  const assumed = new Set(["row", "rec", "r", "_r"]);

  // DECLARE section variable names — `_rec record;`, `_row students%ROWTYPE;`
  const decl = body.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i);
  if (decl) {
    for (const m of decl[1].matchAll(/^\s*([A-Za-z_]\w*)\s+[^;]+;/gm)) observed.add(m[1].toLowerCase());
  }
  // Loop variables — `FOR x IN ...`, and CTE names — `WITH x AS (`
  for (const m of body.matchAll(/\bFOR\s+([A-Za-z_]\w*)\s+IN\b/gi)) observed.add(m[1].toLowerCase());
  for (const m of body.matchAll(/(?:\bWITH\b|,)\s+([A-Za-z_]\w*)\s+AS\s*(?:MATERIALIZED\s*)?\(/gi))
    observed.add(m[1].toLowerCase());
  // Set-returning function aliases — `FROM fn(...) AS pool(qid)`
  for (const m of body.matchAll(/\)\s*(?:AS\s+)?([A-Za-z_]\w*)\s*\(/gi)) observed.add(m[1].toLowerCase());
  for (const n of observed) assumed.delete(n);
  return { observed, assumed };
}

/**
 * alias -> table, from FROM/JOIN/UPDATE/INSERT INTO/DELETE FROM clauses.
 *
 * Aliases are scoped PER QUERY; this map is per FUNCTION. The first version
 * ignored that and produced five false findings on rpc_leaderboard: one clause
 * binds `s` to students_current, and a later clause binds `s` to a different
 * relation entirely, a CTE projecting uid/class_label/score. The parser carried
 * the first binding forward and measured the second against it.
 *
 * So an alias with more than one distinct binding, or ever bound to a name that
 * is not a known table (a CTE, a subquery), is AMBIGUOUS, and every use of it is
 * reported as not-checked. That is the conservative direction on purpose: a gate
 * that cries wolf gets switched off within a week, taking the real findings with
 * it.
 */
function aliasMap(body, knownTables, ctes) {
  const map = new Map();
  const ambiguous = new Set();
  const add = (table, alias) => {
    const t = table.toLowerCase().replace(/^public\./, "");
    const a = (alias || t).toLowerCase();
    if (!knownTables.has(t)) { ambiguous.add(a); return; }
    if (map.has(a) && map.get(a) !== t) ambiguous.add(a);
    map.set(a, t);
  };

  const clause = /\b(?:FROM|JOIN|UPDATE|INTO)\s+((?:public\s*\.\s*)?[A-Za-z_]\w*)\s*(?!\()((?:AS\s+)?([A-Za-z_]\w*))?/gi;
  const RESERVED = new Set([
    "select", "where", "set", "on", "using", "values", "returning", "group", "order",
    "limit", "having", "left", "right", "inner", "outer", "join", "cross", "lateral",
    "and", "or", "as", "loop", "then", "else", "end", "into", "from", "when", "do",
    "conflict", "not", "exists", "with", "union", "all", "distinct", "case", "if",
  ]);
  for (const m of body.matchAll(clause)) {
    const table = m[1].replace(/\s+/g, "");
    const alias = m[3] && !RESERVED.has(m[3].toLowerCase()) ? m[3] : null;
    add(table, alias);
  }
  // Second pass, targeted at CTEs. The general clause regex above missed
  // `FROM claimed c` in ai_embedding_jobs_process_batch, so the alias `c` kept
  // an earlier binding to ai_kms_chunks and three of the CTE's own keys were
  // reported as stale columns. Any alias attached to a CTE is ambiguous: this
  // gate cannot know a CTE's column list.
  if (ctes && ctes.size) {
    const names = [...ctes].join("|");
    const cteAlias = new RegExp("\\b(?:FROM|JOIN)\\s+(?:" + names + ")\\s+(?:AS\\s+)?([A-Za-z_]\\w*)", "gi");
    for (const m of body.matchAll(cteAlias)) ambiguous.add(m[1].toLowerCase());
  }
  for (const a of ambiguous) map.delete(a);
  return { map, ambiguous };
}

/**
 * The core check. Exported in spirit so --self-test can drive it with synthetic
 * bodies rather than needing a broken function to exist in the database.
 */
export function findStaleColumns(def, catalog) {
  const body = stripNoise(bodyOf(def));
  const { observed, assumed } = unresolvableNames(body);
  const { map: aliases, ambiguous } = aliasMap(body, catalog.tables, cteNames(body));

  const findings = [];
  const skipped = new Map();
  const notApplicable = new Map();
  const na = (a) => notApplicable.set(a, (notApplicable.get(a) ?? 0) + 1);

  // `\s*\(` after the second identifier: a call, not a column.
  const REF = /\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\b(\s*\()?/g;

  for (const m of body.matchAll(REF)) {
    const alias = m[1].toLowerCase();
    const column = m[2].toLowerCase();
    if (alias === "public" || alias === "pg_catalog" || alias === "information_schema") continue;

    // A qualified FUNCTION CALL is not a column reference at all. auth.uid()
    // was being counted as an unreadable one in almost every body in the
    // schema, inflating "not checkable" with the one construct here that could
    // never be a column — and burying the aliases that genuinely are unread.
    if (m[3]) { na(alias); continue; }

    if (observed.has(alias)) { na(alias); continue; }

    if (assumed.has(alias) || ambiguous.has(alias)) {
      skipped.set(alias, (skipped.get(alias) ?? 0) + 1);
      continue;
    }
    const table = aliases.get(alias);
    if (!table) {
      skipped.set(alias, (skipped.get(alias) ?? 0) + 1);
      continue;
    }
    const cols = catalog.columns.get(table);
    if (!cols) {
      skipped.set(alias, (skipped.get(alias) ?? 0) + 1);
      continue;
    }
    if (!cols.has(column)) {
      findings.push({ alias, table, column });
    }
  }
  return { findings, skipped, notApplicable };
}

// ── Self test: the gate must be able to fail ──────────────────────────────

async function selfTest(catalog) {
  const cases = [
    {
      name: "the real 7.5c bug: tests.is_published",
      def: "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN\n" +
        "  PERFORM 1 FROM public.tests t WHERE t.is_published AND t.school_id = _s;\n" +
        "RETURN 1; END $fn$",
      expect: ["is_published"],
    },
    {
      name: "the corrected version: tests.published_at",
      def: "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN\n" +
        "  PERFORM 1 FROM public.tests t WHERE t.published_at IS NOT NULL AND t.school_id = _s;\n" +
        "RETURN 1; END $fn$",
      expect: [],
    },
    {
      name: "a column name that only appears inside a string literal",
      def: "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN\n" +
        "  RAISE NOTICE 'see t.is_published for details';\n" +
        "  PERFORM 1 FROM public.tests t WHERE t.school_id = _s;\n" +
        "RETURN 1; END $fn$",
      expect: [],
    },
    {
      name: "a record variable, which must not be read as a table alias",
      def: "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ DECLARE _m record; BEGIN\n" +
        "  FOR _m IN SELECT * FROM public.tests t LOOP RAISE NOTICE '%', _m.anything_at_all; END LOOP;\n" +
        "RETURN 1; END $fn$",
      expect: [],
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const { findings } = findStaleColumns(c.def, catalog);
    const got = findings.map((f) => f.column);
    const ok =
      got.length === c.expect.length && c.expect.every((e) => got.includes(e));
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.name}`);
    if (!ok) {
      console.log(`        expected [${c.expect.join(", ")}], got [${got.join(", ")}]`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed. The gate cannot be trusted either way.`);
    process.exitCode = 1;
  } else {
    console.log(`\nall ${cases.length} self-test cases behaved. The gate detects the real 7.5c bug and does not`);
    console.log(`invent findings from string literals or record variables.`);
  }
}

// ── Run ────────────────────────────────────────────────────────────────────

const colRows = await queryRows(`
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'`);

const catalog = { tables: new Set(), columns: new Map() };
for (const r of colRows) {
  const t = r.table_name.toLowerCase();
  catalog.tables.add(t);
  if (!catalog.columns.has(t)) catalog.columns.set(t, new Set());
  catalog.columns.get(t).add(r.column_name.toLowerCase());
}

if (catalog.tables.size === 0) {
  console.error("no tables found in schema public — the catalog is empty, so every check would pass vacuously");
  await closeConnection();
  process.exit(1);
}

if (SELF_TEST) {
  await selfTest(catalog);
  await closeConnection();
} else {
  const fnRows = await queryRows(`
    SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('plpgsql', 'sql'))
     ORDER BY p.proname`);
  await closeConnection();

  if (fnRows.length === 0) {
    console.error("no functions found — refusing to report that as clean");
    process.exit(1);
  }

  // Scope, if asked. Matched on the whole definition, so a body reaching one of
  // these tables through any syntax is in — a name test, not a `FROM` parse,
  // because deciding scope with the same parser whose blind spots are the thing
  // being measured would hide exactly the functions worth looking at.
  let scoped = fnRows;
  if (SCOPE) {
    const missing = SCOPE.filter((t) => !catalog.tables.has(t));
    scoped = fnRows.filter((f) =>
      SCOPE.some((t) => new RegExp(`\\b${t}\\b`, "i").test(f.def)));
    if (scoped.length === 0) {
      console.error(
        `--scope matched no function bodies. Either the tables are wrong or nothing references them;\n` +
        `either way "no findings" would mean nothing. Refusing to report.`);
      process.exit(1);
    }
    console.log(`Read via ${describeConnection()}.`);
    console.log(
      `SCOPED to ${SCOPE.length} table(s): ${SCOPE.join(", ")}\n` +
      (missing.length
        ? `  ${missing.length} of them no longer exist (${missing.join(", ")}) — dropped tables are still\n` +
          `  worth scoping on, because a body referencing one is exactly what would not be caught.\n`
        : "") +
      `  ${scoped.length} of ${fnRows.length} function bodies reference at least one.`);
  }

  const all = [];
  const skippedTotal = new Map();
  const naTotal = new Map();
  const perFn = [];
  const droppedRefs = [];
  for (const f of scoped) {
    const { findings, skipped, notApplicable } = findStaleColumns(f.def, catalog);
    for (const [k, v] of skipped) skippedTotal.set(k, (skippedTotal.get(k) ?? 0) + v);
    for (const [k, v] of notApplicable) naTotal.set(k, (naTotal.get(k) ?? 0) + v);
    const n = [...skipped.values()].reduce((a, b) => a + b, 0);
    if (n) perFn.push({ signature: f.signature, n, aliases: [...skipped.keys()] });
    for (const fi of findings) all.push({ ...fi, signature: f.signature });

    // A reference to a table that no longer exists resolves to nothing, so it
    // lands in NOT CHECKED and never surfaces. It throws 42P01 on first call.
    if (DROPPED) {
      for (const t of DROPPED) {
        if (new RegExp(`\\b(?:public\\s*\\.\\s*)?${t}\\b`, "i").test(stripNoise(f.def))) {
          droppedRefs.push({ signature: f.signature, table: t });
        }
      }
    }
  }

  if (!SCOPE) console.log(`Read via ${describeConnection()}.`);
  const nSkipped = [...skippedTotal.values()].reduce((a, b) => a + b, 0);
  const nNA = [...naTotal.values()].reduce((a, b) => a + b, 0);
  console.log(
    `${scoped.length} function bodies parsed against ${catalog.tables.size} tables.\n` +
      `  ${String(nNA).padStart(5)}  NOT APPLICABLE  qualified function calls (auth.uid()), NEW/OLD/EXCLUDED,\n` +
      `         ${" ".repeat(9)} and record variables this body declares. Never column references.\n` +
      `  ${String(nSkipped).padStart(5)}  UNRESOLVED      a name used as x.y that should bind to a table and does\n` +
      `         ${" ".repeat(9)} not (${skippedTotal.size} distinct). THIS is where the gate is blind.`,
  );

  if (SCOPE && perFn.length) {
    console.log(`\nwhere the gate stops looking INSIDE this scope, by function:`);
    for (const p of perFn.sort((a, b) => b.n - a.n).slice(0, 25)) {
      console.log(`  ${String(p.n).padStart(4)}  ${p.signature}`);
      console.log(`        ${p.aliases.slice(0, 12).join(" ")}${p.aliases.length > 12 ? " …" : ""}`);
    }
  }

  if (DROPPED) {
    if (droppedRefs.length === 0) {
      console.log(`\nno surviving reference to any of the dropped tables (${DROPPED.join(", ")}).`);
    } else {
      console.log(`\n${droppedRefs.length} REFERENCE(S) TO A DROPPED TABLE — these throw 42P01 on first call:\n`);
      for (const d of droppedRefs) console.log(`  ${d.signature}  ->  public.${d.table}`);
      process.exitCode = 1;
    }
  }

  if (SHOW_SKIPPED) {
    console.log("\nnot checked, by alias — each is a place this gate stops looking:");
    for (const [k, v] of [...skippedTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
  }

  if (all.length === 0) {
    console.log(
      `\nno stale alias.column references. This is a narrower statement than "no stale columns":\n` +
        `  it covers only references whose alias resolves to a real table. Run with --show-skipped\n` +
        `  to see what it could not read.`,
    );
  } else {
    console.log(`\n${all.length} STALE COLUMN REFERENCE(S):\n`);
    for (const f of all) {
      console.log(`  ${f.signature}`);
      console.log(`    ${f.alias}.${f.column}  ->  public.${f.table} has no column "${f.column}"`);
    }
    console.log(
      `\nplpgsql resolves these at execution, so every one of these functions compiles,\n` +
        `passes CREATE OR REPLACE, and throws the first time a real user reaches it.`,
    );
    process.exitCode = 1;
  }
}
