/**
 * Empty the tenant space of a NEWLY PROVISIONED project.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A MIGRATION ─────────────────────────────
 *
 * An earlier ruling had this as a tail migration. That is a loaded gun in
 * `db:migrate`: the applier runs everything pending against whatever project
 * SUPABASE_ACCESS_TOKEN points at, so one routine `npm run db:migrate` against
 * dev would empty dev. A migration cannot refuse to run. A script can, and this
 * one refuses four different ways.
 *
 * ── WHAT IT DELETES ──────────────────────────────────────────────────────
 *
 * Every row in every table carrying `school_id` that belongs to a demo school,
 * then the demo `schools` rows, then the accounts that existed only to populate
 * them, then those `auth.users`.
 *
 * The deletion ORDER IS COMPUTED, not hand-listed. 105 tables carry `school_id`;
 * 40 cascade from `schools`, 57 are ON DELETE NO ACTION and would BLOCK the
 * delete, 2 are RESTRICT, 1 is SET NULL, and 4 have no FK to `schools` at all
 * and would silently strand orphans. A hand-written order goes stale the first
 * time someone adds a table. This reads pg_constraint and sorts children before
 * parents.
 *
 * TWO GENUINE FK CYCLES EXIST in this schema and no delete order satisfies one:
 *   classes.class_teacher_id             <-> teachers.class_teacher_of
 *   community_doubts.solved_by_answer_id <-> community_doubt_answers.doubt_id
 * They are broken by NULLING the nullable side on the demo rows first, which is
 * safe precisely because those rows are deleted in the same transaction. The
 * edges are DISCOVERED rather than hand-listed, one per pass so the breaking set
 * stays minimal, and a cycle made only of NOT NULL columns is REPORTED rather
 * than worked around.
 *
 * ── WHAT MUST SURVIVE ────────────────────────────────────────────────────
 *
 * `question_bank` — 21,696 rows of RBSE reference seed. It has no `school_id`
 * column, so a school-keyed delete cannot reach it, and the run asserts its row
 * count is unchanged rather than assuming.
 *
 * Auth accounts holding no demo membership and no demo profile are NOT deleted.
 * This strips the tenant space, not the auth directory.
 *
 * ── GUARDS, IN ORDER ─────────────────────────────────────────────────────
 *
 *   1. Dry run by default. `--apply` is required to write anything.
 *   2. `--confirm <project-ref>` must NAME the project. Muscle memory cannot
 *      supply it, and it cannot be right for two different projects.
 *   3. Refuses if any school exists that is not a known demo fixture. This is
 *      the one that matters: it makes the script inert against a real school,
 *      and no flag overrides it.
 *   4. Refuses if there are no schools at all — nothing to do means something is
 *      wrong, not that the job is done.
 *
 * Usage:
 *   npm run db:strip-demo-tenants                                 # dry run
 *   node scripts/strip-demo-tenants.mjs --apply --confirm <ref>   # for real
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** The two seeded demo schools. Anything else present means STOP. */
const DEMO_SCHOOLS = [
  "00000000-0000-4000-8000-000000000001", // Wisdom Campus Demo School
  "00000000-0000-4000-8000-000000000002", // Northfield Public School (scale fixture)
];

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const confirmIdx = args.indexOf("--confirm");
const CONFIRMED_REF = confirmIdx === -1 ? null : args[confirmIdx + 1];

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("\nBLOCKED: no SUPABASE_ACCESS_TOKEN. Nothing was asked of the database.\n");
  process.exit(2);
}

async function sql(query, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}: API ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: unparseable response`);
  }
}

const IN_DEMO = DEMO_SCHOOLS.map((u) => `'${u}'`).join(",");

// ── Guard 2 ────────────────────────────────────────────────────────────────
if (APPLY && CONFIRMED_REF !== PROJECT_REF) {
  console.error(
    `\nBLOCKED: --apply requires --confirm ${PROJECT_REF}\n\n` +
      `  You passed: ${CONFIRMED_REF ?? "(nothing)"}\n` +
      "  Naming the project is the point: it cannot be right for two of them.\n",
  );
  process.exit(2);
}

console.log(`Project: ${PROJECT_REF}`);
console.log(APPLY ? "Mode: APPLY — rows will be deleted\n" : "Mode: DRY RUN — nothing will be written\n");

// ── Guards 3 and 4: is this a demo-only project? ───────────────────────────
const schools = await sql("SELECT id::text, name FROM public.schools ORDER BY name", "schools");
const foreign = schools.filter((s) => !DEMO_SCHOOLS.includes(s.id));

console.log(`Schools present: ${schools.length}`);
for (const s of schools) {
  console.log(`  ${DEMO_SCHOOLS.includes(s.id) ? "demo   " : "FOREIGN"} ${s.id}  ${s.name}`);
}

if (foreign.length > 0) {
  console.error(
    `\nREFUSED: ${foreign.length} school(s) are not demo fixtures.\n\n` +
      "  This exists to empty a NEWLY PROVISIONED project. A school it does not\n" +
      "  recognise means real data, and no flag overrides this.\n",
  );
  process.exit(2);
}
if (schools.length === 0) {
  console.error("\nREFUSED: no schools at all. Nothing to strip means something is wrong.\n");
  process.exit(2);
}

// ── The tables ─────────────────────────────────────────────────────────────
const tables = await sql(
  `SELECT c.relname AS tbl
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'school_id'
                     AND a.attnum > 0 AND NOT a.attisdropped)
    ORDER BY 1`,
  "school_id tables",
);
const names = tables.map((t) => t.tbl);

// Single-column FK edges between those tables. Self-references are ignored: one
// DELETE clears the whole table's demo rows, so a self-edge cannot block it.
const edges = await sql(
  `SELECT c.relname AS child, p.relname AS parent,
          a.attname AS col, a.attnotnull AS required
     FROM pg_constraint k
     JOIN pg_class c ON c.oid = k.conrelid
     JOIN pg_class p ON p.oid = k.confrelid
     JOIN pg_namespace nc ON nc.oid = c.relnamespace
     JOIN pg_namespace np ON np.oid = p.relnamespace
     JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND nc.nspname = 'public' AND np.nspname = 'public'
      AND c.relname <> p.relname
      AND array_length(k.conkey, 1) = 1`,
  "fk edges",
);

const inSet = new Set(names);
let usable = edges.filter((e) => inSet.has(e.child) && inSet.has(e.parent));

function sortChildrenFirst(edgeSet) {
  const referencedBy = new Map(names.map((n) => [n, new Set()]));
  for (const e of edgeSet) referencedBy.get(e.parent).add(e.child);
  const out = [];
  const seen = new Set();
  let progress = true;
  while (progress && seen.size < names.length) {
    progress = false;
    for (const t of names) {
      if (seen.has(t)) continue;
      if ([...referencedBy.get(t)].every((c) => seen.has(c))) {
        out.push(t);
        seen.add(t);
        progress = true;
      }
    }
  }
  return { out, stuck: names.filter((n) => !seen.has(n)) };
}

const broken = [];
let attempt = sortChildrenFirst(usable);

while (attempt.stuck.length > 0) {
  const stuck = new Set(attempt.stuck);
  // Only a NULLABLE edge may be broken. A cycle made entirely of required
  // columns cannot be resolved by nulling and is reported, not worked around.
  const candidates = usable.filter((e) => stuck.has(e.child) && stuck.has(e.parent) && !e.required);
  if (candidates.length === 0) {
    console.error(
      `\nREFUSED: FK cycle with no nullable edge to break, among ${attempt.stuck.length} table(s):\n` +
        `  ${attempt.stuck.join(", ")}\n\n` +
        "  A guessed order would fail halfway and leave the project neither empty\n" +
        "  nor seeded. Break the cycle deliberately in a migration.\n",
    );
    process.exit(2);
  }
  // One per pass, then re-sort: breaking every nullable edge in the stalled
  // component at once also breaks edges that were never in a cycle, which hides
  // which cycles actually exist.
  const pick = candidates[0];
  broken.push(pick);
  usable = usable.filter((e) => !(e.child === pick.child && e.col === pick.col));
  attempt = sortChildrenFirst(usable);
}

const order = attempt.out;

console.log(`\n${names.length} table(s) carry school_id; deletion order computed from the FK graph.`);
if (broken.length > 0) {
  console.log(`${broken.length} cyclic edge(s) broken by nulling first (all nullable):`);
  for (const e of broken) console.log(`  ${e.child}.${e.col} -> ${e.parent}`);
}

// ── What would go ──────────────────────────────────────────────────────────
const countsQuery = (tbls) =>
  tbls
    .map((t) => `SELECT '${t}' AS tbl, count(*)::bigint AS n FROM public.${t} WHERE school_id IN (${IN_DEMO})`)
    .join(" UNION ALL ");

const counts = await sql(countsQuery(order), "counts");
const nonZero = counts.filter((c) => Number(c.n) > 0).sort((a, b) => Number(b.n) - Number(a.n));
const total = counts.reduce((s, c) => s + Number(c.n), 0);

console.log(`\nRows to delete: ${total} across ${nonZero.length} table(s)`);
for (const c of nonZero.slice(0, 15)) console.log(`  ${String(c.n).padStart(7)}  ${c.tbl}`);
if (nonZero.length > 15) console.log(`  ... and ${nonZero.length - 15} more`);

// ONE predicate, used by both the count and the DELETE. Written separately at
// first, they disagreed — which would have reported a number the run did not
// honour.
const DEMO_ACCOUNTS = `
    u.email LIKE '%@northfield.test'
    OR EXISTS (SELECT 1 FROM public.memberships m
                WHERE m.account_id = u.id AND m.school_id IN (${IN_DEMO}))
    OR EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = u.id AND p.school_id IN (${IN_DEMO}))`;

const accounts = await sql(`SELECT count(*)::bigint AS n FROM auth.users u WHERE ${DEMO_ACCOUNTS}`, "demo accounts");
const surviving = await sql(`SELECT count(*)::bigint AS n FROM auth.users u WHERE NOT (${DEMO_ACCOUNTS})`, "surviving");

console.log(`\nauth.users to delete: ${accounts[0].n}   (surviving: ${surviving[0].n})`);
console.log("  Survivors hold no demo membership and no demo profile — real sign-ups,");
console.log("  if any. Not deleted: this strips the tenant space, not the auth directory.");

const bankBefore = await sql("SELECT count(*)::bigint AS n FROM public.question_bank", "bank before");
console.log(`\nquestion_bank rows (must not change): ${bankBefore[0].n}`);

if (!APPLY) {
  console.log(
    "\nDRY RUN — nothing written.\n" +
      `  To apply:  node scripts/strip-demo-tenants.mjs --apply --confirm ${PROJECT_REF}\n`,
  );
  process.exit(0);
}

// ── Apply, in one transaction ──────────────────────────────────────────────
//
// auth.users is deleted with SQL rather than the admin API so it lands in the
// SAME transaction as the tenant rows. The admin API is the alternative where
// only a service-role key is available; it cannot be transactional, so a failure
// halfway would leave orphaned auth users behind.
const statements = [
  "BEGIN;",
  ...broken.map((e) => `UPDATE public.${e.child} SET ${e.col} = NULL WHERE school_id IN (${IN_DEMO});`),
  ...order.map((t) => `DELETE FROM public.${t} WHERE school_id IN (${IN_DEMO});`),
  // Account-scoped tables with no school_id of their own.
  `DELETE FROM public.sessions s WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.account_id AND (${DEMO_ACCOUNTS}));`,
  `DELETE FROM public.user_roles r WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id AND (${DEMO_ACCOUNTS}));`,
  `DELETE FROM public.schools WHERE id IN (${IN_DEMO});`,
  `DELETE FROM auth.users u WHERE ${DEMO_ACCOUNTS};`,
  "DELETE FROM public.accounts a WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.id);",
  "COMMIT;",
];

console.log("\nApplying…");
await sql(statements.join("\n"), "strip");

// ── Prove it ───────────────────────────────────────────────────────────────
const after = await sql(countsQuery(order), "verify");
const leftovers = after.filter((c) => Number(c.n) > 0);
const bankAfter = await sql("SELECT count(*)::bigint AS n FROM public.question_bank", "bank after");
const schoolsAfter = await sql("SELECT count(*)::bigint AS n FROM public.schools", "schools after");

let failed = false;
if (leftovers.length > 0) {
  failed = true;
  console.error(`\nFAIL: ${leftovers.length} table(s) still hold demo rows:`);
  for (const c of leftovers) console.error(`  ${c.n}  ${c.tbl}`);
}
if (bankAfter[0].n !== bankBefore[0].n) {
  failed = true;
  console.error(`\nFAIL: question_bank changed — ${bankBefore[0].n} -> ${bankAfter[0].n}. Reference seed was touched.`);
}
if (Number(schoolsAfter[0].n) !== 0) {
  failed = true;
  console.error(`\nFAIL: ${schoolsAfter[0].n} school(s) remain.`);
}

if (failed) process.exit(1);

console.log(
  `\nPASS: 0 rows reference either demo school across all ${order.length} school-scoped table(s).\n` +
    `  question_bank unchanged at ${bankAfter[0].n}. schools now empty.\n` +
    "  Bounded: it proves the enumerated tables are clear, not that the project\n" +
    "  is fit to hand to a school.\n",
);
