// node rt220.mjs [template] — 20260925220000 on the replica, round trip WITH USE:
//   M proves itself on the template (F1); the school is USED as ruled (rps-use-220.sql: the admin adds a teacher and a
//   student, their logins are linked by the app's own trigger, the teacher sets homework); R must remove the school
//   and everyone added into it, touching no other school; M must apply again and rebuild exactly F1.
import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const tpl = process.argv[2] ?? "tpl_r18";
const M = "supabase/migrations/20260925220000_riverside_public_school_awaits_its_people.sql";
const R = "supabase/migrations/rollback/20260925220000_riverside_public_school_awaits_its_people.rollback.sql";
const pg = createRequire(path.join(repo, "package.json"))("pg");
const { splitSql } = await import(pathToFileURL(path.join(repo, "scripts/local-replica/splitSql.mjs")).href);
const admin = new pg.Client({ host: "127.0.0.1", port: 5433, user: "postgres", database: "postgres" });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS gurukul WITH (FORCE)");
await admin.query(`CREATE DATABASE gurukul TEMPLATE ${tpl}`);
await admin.end();
const connect = async () => {
  const c = new pg.Client({ host: "127.0.0.1", port: 5433, user: "postgres", database: "gurukul" });
  c.on("notice", (n) => { if (/verify OK|rollback OK|removed|use OK|stands/.test(n.message)) console.log(`  ${n.message.slice(0, 170)}…`); });
  await c.connect();
  return c;
};
let bad = 0;
const run = async (label, sql) => {
  const c = await connect();
  const stmts = splitSql(sql);
  for (const [i, s] of stmts.entries()) {
    try { await c.query(s); } catch (e) { console.log(`FAIL ${label} at statement ${i + 1}/${stmts.length}: ${e.message}`); await c.end(); process.exit(1); }
  }
  await c.end();
  console.log(`OK ${label}`);
};
const q = async (sql) => { const c = await connect(); const r = await c.query(sql); await c.end(); return r.rows; };
const SCHOOL = "00000000-0000-4000-8000-000000000003";
const fingerprint = async (op) => {
  const tables = (await q(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'school_id' ORDER BY 1`)).map((r) => r.table_name);
  const out = {};
  for (const t of tables) {
    const [r] = await q(`SELECT count(*)::int AS n FROM public."${t}" WHERE school_id ${op} '${SCHOOL}'`);
    if (r.n) out[t] = r.n;
  }
  const [u] = await q(`SELECT count(*)::int AS n FROM auth.users WHERE email ${op === "=" ? "LIKE" : "NOT LIKE"} '%@rps.e2e.test'`);
  out["auth.users"] = u.n;
  return out;
};
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).map((k) => `${k} ${a[k] ?? 0}→${b[k] ?? 0}`);

const others0 = await fingerprint("<>");
await run("M", readFileSync(path.join(repo, M), "utf8"));
const F1 = await fingerprint("=");
console.log(`  Riverside after M: ${JSON.stringify(F1)}`);
if (!F1.classes) { bad++; console.log("FAIL M wrote no sections — the round trip could not fail"); }

await run("USE", readFileSync(path.join(here, "rps-use-220.sql"), "utf8"));
const used = await fingerprint("=");
console.log(`  use wrote: ${diff(F1, used).join(", ") || "NOTHING"}`);
for (const t of ["teachers", "students", "teacher_classes", "homework"]) {
  if (!(used[t] >= 1)) { bad++; console.log(`FAIL the school was not used: no ${t}`); }
}
if (!(used["auth.users"] >= 4)) { bad++; console.log("FAIL the people the admin added have no logins"); }

await run("R", readFileSync(path.join(repo, R), "utf8"));
const F2 = await fingerprint("=");
const left = Object.entries(F2).filter(([, n]) => n);
if (left.length) { bad++; console.log(`FAIL R left Riverside rows or logins: ${JSON.stringify(Object.fromEntries(left))}`); }
const moved = diff(others0, await fingerprint("<>"));
if (moved.length) { bad++; console.log(`FAIL R changed other schools: ${moved.join(", ")}`); }

await run("M again", readFileSync(path.join(repo, M), "utf8"));
const again = diff(F1, await fingerprint("="));
if (again.length) { bad++; console.log(`FAIL M after R does not rebuild the same school: ${again.join(", ")}`); }

console.log(bad ? `\n${bad} FAILURE(S)` : `\nround trip with use OK on ${tpl}`);
process.exit(bad ? 1 : 0);
