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

function unresolvableNames(body) {
  const names = new Set(["new", "old", "tg_argv", "tg_table_name", "excluded", "row", "rec", "r", "_r"]);

  // DECLARE section variable names — `_rec record;`, `_row students%ROWTYPE;`
  const decl = body.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i);
  if (decl) {
    for (const m of decl[1].matchAll(/^\s*([A-Za-z_]\w*)\s+[^;]+;/gm)) names.add(m[1].toLowerCase());
  }
  // Loop variables — `FOR x IN ...`, and CTE names — `WITH x AS (`
  for (const m of body.matchAll(/\bFOR\s+([A-Za-z_]\w*)\s+IN\b/gi)) names.add(m[1].toLowerCase());
  for (const m of body.matchAll(/(?:\bWITH\b|,)\s+([A-Za-z_]\w*)\s+AS\s*(?:MATERIALIZED\s*)?\(/gi))
    names.add(m[1].toLowerCase());
  // Set-returning function aliases — `FROM fn(...) AS pool(qid)`
  for (const m of body.matchAll(/\)\s*(?:AS\s+)?([A-Za-z_]\w*)\s*\(/gi)) names.add(m[1].toLowerCase());
  return names;
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
  const skip = unresolvableNames(body);
  const { map: aliases, ambiguous } = aliasMap(body, catalog.tables, cteNames(body));

  const findings = [];
  const skipped = new Map();

  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\b/g)) {
    const alias = m[1].toLowerCase();
    const column = m[2].toLowerCase();
    if (alias === "public" || alias === "pg_catalog" || alias === "information_schema") continue;
    if (skip.has(alias) || ambiguous.has(alias)) {
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
  return { findings, skipped };
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

  const all = [];
  const skippedTotal = new Map();
  for (const f of fnRows) {
    const { findings, skipped } = findStaleColumns(f.def, catalog);
    for (const [k, v] of skipped) skippedTotal.set(k, (skippedTotal.get(k) ?? 0) + v);
    for (const fi of findings) all.push({ ...fi, signature: f.signature });
  }

  console.log(`Read via ${describeConnection()}.`);
  console.log(
    `${fnRows.length} function bodies parsed against ${catalog.tables.size} tables; ` +
      `${[...skippedTotal.values()].reduce((a, b) => a + b, 0)} reference(s) not checkable ` +
      `(${skippedTotal.size} distinct alias(es)).`,
  );

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
