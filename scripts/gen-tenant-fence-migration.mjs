/**
 * Generate the migration that converts per-row `same_school(x)` tenant fences
 * to the indexable set form `x IN (SELECT my_accessible_school_ids())`.
 *
 * WHY GENERATED. 71 RESTRICTIVE policies across ~70 tables are the tenancy
 * choke point of the whole schema. Hand-transcribing them is how a fence loses
 * a term and a tenant leaks. This reads the LIVE definition of each policy and
 * rewrites exactly one sub-expression, leaving name, command, roles,
 * permissiveness and every other term byte-identical.
 *
 * THE REWRITE, AND WHY IT IS EQUIVALENT
 *
 *   same_school(x)  =  x IS NOT NULL
 *                      AND ( x = get_my_school_id()
 *                            OR (super_admin_has_any_access()
 *                                AND super_admin_has_access(x)) )
 *
 *   my_accessible_school_ids()  =  { get_my_school_id() }  (when non-null)
 *                                ∪ { schools with a live super-admin grant }
 *
 * so `x IN (SELECT my_accessible_school_ids())` admits exactly the same set.
 * NULL differs only in form: `same_school(NULL)` is false and
 * `NULL IN (...)` is NULL, and both exclude a row in USING and fail it in
 * WITH CHECK. Every fence already carries its own `school_id IS NULL OR ...`
 * branch, which is preserved untouched.
 *
 * WHAT THIS DOES NOT TOUCH. Only policies whose name ends in `tenant_fence`.
 * The 104 permissive policies that also call `same_school` keep it: they run
 * only for rows the fence already admitted, so they are not what turns a query
 * into a full scan, and rewriting them would widen this change without
 * measuring that it helps.
 *
 * Usage:  node scripts/gen-tenant-fence-migration.mjs > <migration>.sql
 */
import { queryRows, closeConnection } from "./lib/readonly-db.mjs";

const CMD = { "*": "ALL", r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE" };

/** Replace every `same_school(<expr>)` call, honouring nested parentheses. */
function rewrite(expr) {
  if (!expr) return { text: expr, count: 0 };
  let out = "";
  let i = 0;
  let count = 0;
  while (i < expr.length) {
    const at = expr.indexOf("same_school(", i);
    if (at === -1) {
      out += expr.slice(i);
      break;
    }
    out += expr.slice(i, at);
    let depth = 0;
    let j = at + "same_school(".length - 1;
    for (; j < expr.length; j++) {
      if (expr[j] === "(") depth++;
      else if (expr[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error("unbalanced parentheses in: " + expr);
    const arg = expr.slice(at + "same_school(".length, j).trim();
    out += `(${arg} IN ( SELECT public.my_accessible_school_ids() AS my_accessible_school_ids))`;
    count++;
    i = j + 1;
  }
  return { text: out, count };
}

/** --rollback emits the CURRENT (same_school) definitions verbatim. */
const ROLLBACK = process.argv.includes('--rollback');

const rows = await queryRows(`
  SELECT c.relname AS tbl,
         p.polname,
         p.polcmd,
         p.polpermissive,
         CASE WHEN p.polroles = '{0}' THEN 'PUBLIC'
              ELSE array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)), ', ')
         END AS roles,
         pg_get_expr(p.polqual, p.polrelid)      AS using_expr,
         pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND p.polname LIKE '%tenant_fence%'
     AND (pg_get_expr(p.polqual, p.polrelid) LIKE '%same_school%'
       OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%same_school%')
   ORDER BY c.relname, p.polname
`);

const parts = [];
let replaced = 0;
for (const r of rows) {
  const u = ROLLBACK ? { text: r.using_expr, count: 0 } : rewrite(r.using_expr);
  const w = ROLLBACK ? { text: r.check_expr, count: 0 } : rewrite(r.check_expr);
  replaced += u.count + w.count;
  if (r.polpermissive) {
    throw new Error(`${r.tbl}.${r.polname} is PERMISSIVE; this generator only converts RESTRICTIVE fences`);
  }
  const lines = [
    `DROP POLICY IF EXISTS ${r.polname} ON public.${r.tbl};`,
    `CREATE POLICY ${r.polname} ON public.${r.tbl}`,
    `AS RESTRICTIVE`,
    `FOR ${CMD[r.polcmd]}`,
    `TO ${r.roles}`,
  ];
  if (u.text) lines.push(`USING (${u.text})`);
  if (w.text) lines.push(`WITH CHECK (${w.text})`);
  parts.push(lines.join("\n") + ";");
}

process.stdout.write(parts.join("\n\n") + "\n");
process.stderr.write(
  `-- generated ${rows.length} policies, ${replaced} same_school call(s) rewritten\n`,
);
await closeConnection();
