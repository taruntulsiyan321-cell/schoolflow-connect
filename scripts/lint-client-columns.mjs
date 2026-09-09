/**
 * The client half of G15 — TypeScript that names a column the table has not got.
 *
 *   node scripts/lint-client-columns.mjs
 *   node scripts/lint-client-columns.mjs --self-test     # prove it can fail
 *   node scripts/lint-client-columns.mjs --show-skipped  # what it could not check
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT PART OF lint-stale-columns ────────
 *
 * `lint:stale-columns` asks exactly the right question — "does this column
 * exist on that table" — of 340 SQL function bodies. It cannot see TypeScript,
 * and its own header says so.
 *
 * That blind spot has a measured cost. `src/academic/services/testService.ts`
 * sent SIX columns `public.tests` does not have — `class_id`, `subject`,
 * `is_published`, `question_count`, `subject_id`, `max_marks` — and omitted the
 * two NOT NULL ones. Every teacher write path was addressed to a table shape
 * that had not existed since Chunk 7.5. It passed typecheck (the generated
 * types were cast away), it passed lint, it passed the whole gate set, and it
 * passed `lint:stale-columns` because that gate only reads SQL. It was found by
 * a probe running as a real teacher, weeks later:
 *
 *     ERROR: column "class_id" of relation "tests" does not exist
 *
 * A gate that reads only half the codebase reports clean on the other half.
 * This is the other half.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────
 *
 * PostgREST builder chains. Within one chain rooted at `.from("table")`:
 *
 *   .select("a, b, rel(x)")     top-level names in the list
 *   .insert({ a, b })           object keys
 *   .update({ a })  .upsert()   object keys
 *   .eq("a", …) .neq .gt .gte .lt .lte .like .ilike .in .is .contains
 *   .order("a")  .filter("a", …)
 *
 * ── WHAT IT REFUSES TO CLAIM ────────────────────────────────────────────
 *
 * A finding needs BOTH facts certain: the chain names a real table, and the
 * column definitively is not on it. Everything else is counted and reported as
 * NOT CHECKED, never as passed:
 *
 *   - a chain whose table is a variable rather than a literal
 *   - a `.select()` with a template literal or a variable
 *   - an embedded resource — `section_subjects(section_id)` — whose inner names
 *     belong to another table; the relation name is checked, the inner list is
 *     not
 *   - a spread in an insert object, whose keys are not visible here
 *   - a view or RPC rather than a base table
 *
 * That is the same contract `lint-stale-columns` states, for the same reason: a
 * parser that quietly skips what it cannot understand reports clean because it
 * did not look.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { queryRows, describeConnection, closeConnection } from "./lib/readonly-db.mjs";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const SHOW_SKIPPED = argv.includes("--show-skipped");

const SRC = "src";

/** Builder methods whose FIRST string argument is a column name. */
const COLUMN_FIRST_ARG = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
  "contains", "containedBy", "order", "filter", "not",
]);

/** Builder methods whose first argument is an object (or array) of column keys. */
const OBJECT_ARG = new Set(["insert", "update", "upsert"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Split a `.select()` list into top-level names.
 *
 * `"*, section_subjects(section_id, curriculum_subjects(name))"` yields
 * `["*", "section_subjects(...)"]` — the nested list is NOT flattened, because
 * those names belong to a different table and checking them here would produce
 * confident nonsense.
 */
function topLevelSelectParts(list) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** `alias:column` -> column; `count(*)` and modifiers stripped. */
function bareColumn(part) {
  let s = part.trim();
  if (s.includes(":")) s = s.slice(s.indexOf(":") + 1).trim();
  s = s.replace(/::[a-z_]+$/i, "");           // ::text casts
  s = s.replace(/\.[a-z_]+$/i, "");           // ->>json paths already excluded below
  return s.trim();
}

async function loadSchema() {
  const rows = await queryRows(`
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  `);
  const byTable = new Map();
  for (const r of rows) {
    const t = String(r.table_name);
    if (!byTable.has(t)) byTable.set(t, new Set());
    byTable.get(t).add(String(r.column_name));
  }
  return byTable;
}

function analyseFile(path, text, schema, findings, skipped, stats) {
  // Each `.from("x")` starts a chain. The chain is the source text up to the
  // next `.from(` or a blank line at lower indentation — deliberately crude,
  // and everything it cannot attribute is counted rather than assumed.
  const fromRe = /\.from\(\s*(["'`])([^"'`]+)\1\s*\)/g;
  let m;
  while ((m = fromRe.exec(text)) !== null) {
    const table = m[2];
    stats.chains++;

    if (!schema.has(table)) {
      // A view, an RPC-backed name, or a table this gate cannot see. Not a
      // finding — an unknown table means unknown columns.
      skipped.push({ path, table, why: "not a base table in public" });
      continue;
    }
    const cols = schema.get(table);

    // The chain: from here to the next `.from(`, capped so one long file does
    // not swallow the rest of itself.
    const rest = text.slice(m.index + m[0].length);
    const nextFrom = rest.search(/\.from\(/);
    const chain = rest.slice(0, nextFrom === -1 ? 2000 : Math.min(nextFrom, 2000));

    // ── .select("…") ─────────────────────────────────────────────────────
    const selRe = /\.select\(\s*(["'])([^"']*)\1/g;
    let s;
    while ((s = selRe.exec(chain)) !== null) {
      for (const part of topLevelSelectParts(s[2])) {
        if (!part || part === "*") continue;
        if (part.includes("(")) {
          // Embedded resource. The relation NAME is checkable only as a
          // relationship, which this gate does not model; the inner list
          // belongs to another table.
          skipped.push({ path, table, why: `embedded resource ${part.split("(")[0]}(…)` });
          continue;
        }
        const col = bareColumn(part);
        if (!col || col.includes("->") || col.includes("!")) {
          skipped.push({ path, table, why: `unparsed select part "${part}"` });
          continue;
        }
        stats.checked++;
        if (!cols.has(col)) findings.push({ path, table, col, kind: "select" });
      }
    }
    // A select built from a variable or template literal cannot be read.
    for (const bad of chain.matchAll(/\.select\(\s*[`a-zA-Z_$]/g)) {
      void bad;
      skipped.push({ path, table, why: "select() is not a plain string literal" });
    }

    // ── .eq("col", …) and friends ────────────────────────────────────────
    const argRe = /\.([a-zA-Z]+)\(\s*(["'])([^"']+)\2/g;
    let a;
    while ((a = argRe.exec(chain)) !== null) {
      const method = a[1];
      if (!COLUMN_FIRST_ARG.has(method)) continue;
      const raw = a[3];
      // `.or("a.eq.1,b.eq.2")` is a different grammar, and `metadata->>class_id`
      // is a JSON path INTO a column rather than a column name — the part
      // before the arrow is the column and the rest is a key inside it. The
      // first run of this gate reported `metadata->>class_id` as missing from
      // `school_activity_feed`, which was the parser's fault, not the code's.
      if (raw.includes(",") || raw.includes(".") || raw.includes("(") || raw.includes("->")) {
        skipped.push({ path, table, why: `${method}() argument is a filter or JSON path` });
        continue;
      }
      stats.checked++;
      if (!cols.has(raw)) findings.push({ path, table, col: raw, kind: method });
    }

    // ── .insert({ … }) / .update({ … }) ──────────────────────────────────
    for (const method of OBJECT_ARG) {
      const opRe = new RegExp(`\\.${method}\\(\\s*\\{`, "g");
      let o;
      while ((o = opRe.exec(chain)) !== null) {
        // Read balanced braces from the opening one.
        let depth = 0;
        let i = chain.indexOf("{", o.index);
        const start = i;
        for (; i < chain.length; i++) {
          if (chain[i] === "{") depth++;
          else if (chain[i] === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        if (depth !== 0) {
          skipped.push({ path, table, why: `${method}() object not closed within the chain` });
          continue;
        }
        const body = chain.slice(start + 1, i);
        if (body.includes("...")) {
          skipped.push({ path, table, why: `${method}() object contains a spread` });
        }
        // Top-level `key:` pairs only — nested object values are column VALUES.
        let d = 0;
        for (const km of body.matchAll(/(^|[,{])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
          const before = body.slice(0, km.index);
          d = (before.match(/[{[]/g) || []).length - (before.match(/[}\]]/g) || []).length;
          if (d !== 0) continue;
          const key = km[2];
          stats.checked++;
          if (!cols.has(key)) findings.push({ path, table, col: key, kind: method });
        }
      }
    }
  }
}

async function main() {
  let schema;
  try {
    schema = await loadSchema();
  } catch (e) {
    console.error("BLOCKED: could not read the schema, so nothing was compared.");
    console.error(`  via ${describeConnection()}`);
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    console.error("  This is NOT a pass. Do not read it as one.");
    return 2;
  }
  if (schema.size === 0) {
    console.error("BLOCKED: the schema came back with no tables — a broken read, not a clean run.");
    return 2;
  }

  const files = walk(SRC);
  const findings = [];
  const skipped = [];
  const stats = { chains: 0, checked: 0 };

  for (const f of files) {
    analyseFile(relative(process.cwd(), f), readFileSync(f, "utf8"), schema, findings, skipped, stats);
  }

  // THE NEGATIVE CONTROL. A gate that has never been seen to fail is a gate
  // nobody knows works — and this one's whole reason for existing is that the
  // last gate reported clean because it could not see.
  if (SELF_TEST) {
    const probeFindings = [];
    const probeSkipped = [];
    const probeStats = { chains: 0, checked: 0 };
    const injected = `
      const bad = client.from("tests").select("id, class_id, is_published").eq("subject_id", x);
      const worse = client.from("tests").insert({ max_marks: 5, question_count: 2 });
    `;
    analyseFile("(self-test)", injected, schema, probeFindings, probeSkipped, probeStats);
    const want = ["class_id", "is_published", "subject_id", "max_marks", "question_count"];
    const got = probeFindings.map((f) => f.col);
    const missed = want.filter((w) => !got.includes(w));
    console.log(`SELF-TEST: injected ${want.length} known-stale column(s) from the real testService defect.`);
    console.log(`  caught: ${got.join(", ") || "(none)"}`);
    if (missed.length) {
      console.error(`FAIL: the gate did not catch ${missed.join(", ")} — it cannot detect what it exists for.`);
      return 1;
    }
    console.log("PASS: the gate catches the defect that got past lint:stale-columns.");
    return 0;
  }

  console.log(`Read the schema via ${describeConnection()}.`);
  console.log(
    `${files.length} TypeScript file(s) · ${stats.chains} PostgREST chain(s) · ` +
      `${stats.checked} column reference(s) checked · ${skipped.length} NOT CHECKED`,
  );
  console.log("");

  if (SHOW_SKIPPED) {
    const byWhy = new Map();
    for (const s of skipped) byWhy.set(s.why, (byWhy.get(s.why) ?? 0) + 1);
    console.log("NOT CHECKED, by reason:");
    for (const [why, n] of [...byWhy.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${why}`);
    }
    console.log("");
  }

  if (findings.length === 0) {
    console.log("no client code names a column its table has not got.");
    console.log("  Bounded: this covers PostgREST chains whose table is a string");
    console.log("  literal. Run with --show-skipped for exactly what it could not read.");
    return 0;
  }

  console.log(`FAIL: ${findings.length} reference(s) to a column that does not exist:`);
  for (const f of findings) {
    console.log(`  ${f.path}  ${f.table}.${f.col}   (${f.kind})`);
  }
  console.log("");
  console.log("  Each of these will fail at RUNTIME, as a PostgREST error naming the");
  console.log("  column — the shape testService.ts shipped with for weeks.");
  return 1;
}

process.exitCode = await main().catch((e) => {
  console.error(`BLOCKED: ${e instanceof Error ? e.message : String(e)}`);
  return 2;
});
await closeConnection();
