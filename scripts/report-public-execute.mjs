/**
 * Chunk 9.5 step 1 — the report, before anything is revoked.
 *
 *   node scripts/report-public-execute.mjs            # summary + contradictions
 *   node scripts/report-public-execute.mjs --full     # every function
 *   node scripts/report-public-execute.mjs --out docs/PUBLIC_EXECUTE_AUDIT.md
 *
 * PUBLIC reaches anon and authenticated, so every function listed here is
 * callable by every signed-in user today, and Postgres has no deny-grant so no
 * GRANT written elsewhere takes that away. G13 exists because five definers
 * turned out not to fence themselves; this asks the same question of all of
 * them.
 *
 * WHAT "WRITES" MEANS HERE, AND WHAT IT DOES NOT
 * Two signals, combined, and neither is a proof on its own:
 *   volatility  STABLE and IMMUTABLE functions CANNOT modify the database --
 *               Postgres enforces that at run time. This is a hard fact and it
 *               clears a large number of functions outright.
 *   body regex  for VOLATILE functions, whether the body contains a write verb.
 *               A heuristic: it over-reports (the word "update" in a comment or
 *               a column named updated_at) and can under-report (a write behind
 *               EXECUTE format(...)). Treated as "needs reading", never as a
 *               verdict, and the counts below say which is which.
 * A VOLATILE function with no write verb is NOT declared safe -- it is declared
 * unreviewed, because volatility is a promise the author made, not one Postgres
 * checked.
 */
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { queryRows, describeConnection, closeConnection } from "./lib/readonly-db.mjs";

const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const OUT = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
})();

// ── 1. The grants, from the catalog ────────────────────────────────────────
const rows = await queryRows(`
  SELECT p.oid::regprocedure::text                      AS signature,
         p.proname                                      AS name,
         p.prosecdef                                    AS is_definer,
         p.provolatile                                  AS volatility,
         has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_exec,
         (p.proacl IS NULL)                             AS acl_is_default,
         coalesce((
           SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                           ELSE a.grantee::regrole::text END, ',')
             FROM aclexplode(p.proacl) a
            WHERE a.privilege_type = 'EXECUTE'
         ), '') AS explicit_execute_grants,
         (p.provolatile = 'v'
          AND pg_get_functiondef(p.oid) ~* '(insert[[:space:]]+into|update[[:space:]]+public\\.|update[[:space:]]+[a-z_]+[[:space:]]+set|delete[[:space:]]+from|truncate[[:space:]])')
                                                        AS body_has_write_verb
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND has_function_privilege('public', p.oid, 'EXECUTE')
   ORDER BY p.prosecdef DESC, p.proname`);

const connection = describeConnection();
await closeConnection();

if (rows.length === 0) {
  console.error(
    "No PUBLIC-executable functions found.\n" +
      "  Either the revoke has already run, or this query is wrong. Both are worth\n" +
      "  knowing, and neither is a clean report -- exiting non-zero so an empty\n" +
      "  result is never mistaken for a closed hole.",
  );
  process.exit(1);
}

// ── 2. Who does the client actually call? ──────────────────────────────────
// A function nothing calls is a function nothing breaks when it is revoked, and
// that distinction is the whole shape of the batching plan.
const called = new Map();
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) {
        if (!called.has(m[1])) called.set(m[1], new Set());
        called.get(m[1]).add(p.replace(/\\/g, "/"));
      }
    }
  }
}
for (const root of ["src", "supabase/functions"]) if (existsSync(root)) walk(root);

// ── 3. What does the G13 inventory claim? ──────────────────────────────────
const inventory = existsSync("supabase/definer-inventory.json")
  ? JSON.parse(readFileSync("supabase/definer-inventory.json", "utf8"))
  : {};
const declared = new Map();
for (const group of Object.values(inventory)) {
  if (!group || typeof group !== "object") continue;
  for (const [key, entry] of Object.entries(group)) {
    if (entry && typeof entry === "object" && "readerSet" in entry) {
      declared.set(key, entry.readerSet);
      declared.set(key.replace(/\(.*$/, ""), entry.readerSet);
    }
  }
}

// ── 4. Classify ────────────────────────────────────────────────────────────
const VOL = { v: "VOLATILE", s: "STABLE", i: "IMMUTABLE" };
for (const r of rows) {
  r.callers = called.get(r.name) ? [...called.get(r.name)] : [];
  r.declaredReaderSet = declared.get(r.signature) ?? declared.get(r.name) ?? null;
  r.internalName = r.name.startsWith("_");
  r.cannotWrite = r.volatility !== "v";
  r.risk =
    r.is_definer && r.body_has_write_verb ? "definer-writes"
    : r.is_definer && !r.cannotWrite ? "definer-volatile"
    : r.is_definer ? "definer-readonly"
    : r.body_has_write_verb ? "invoker-writes"
    : "invoker";
}

const definers = rows.filter((r) => r.is_definer);
const writers = rows.filter((r) => r.body_has_write_verb);
const internal = rows.filter((r) => r.internalName);
const uncalled = rows.filter((r) => r.callers.length === 0);
const clientCalled = rows.filter((r) => r.callers.length > 0);

// A declared reader set narrower than PUBLIC is the function contradicting
// itself: the inventory says who may call it, and the grant says everyone may.
const NARROWER = new Set(["none", "self", "parent", "teacher", "staff", "school"]);
const contradictions = rows.filter((r) => r.declaredReaderSet && NARROWER.has(r.declaredReaderSet));

const L = [];
const say = (s = "") => L.push(s);

say(`# Chunk 9.5 — what PUBLIC can execute today`);
say();
say(`Read via ${connection}.`);
say();
say(`**${rows.length} functions in \`public\` are EXECUTE-able by \`PUBLIC\`.** \`PUBLIC\` reaches`);
say(`\`anon\` and \`authenticated\`, so every signed-in user can call all of them now.`);
say();
say(`| group | count | why it matters |`);
say(`|---|---|---|`);
say(`| SECURITY DEFINER | ${definers.length} | RLS does not run inside the body; the fence must be written by hand |`);
say(`| ...of those, body has a write verb | ${definers.filter((r) => r.body_has_write_verb).length} | a caller with no rights can cause a write |`);
say(`| ...of those, VOLATILE but no write verb found | ${definers.filter((r) => !r.cannotWrite && !r.body_has_write_verb).length} | unreviewed, not safe — volatility is the author's claim, not Postgres's check |`);
say(`| ...of those, STABLE/IMMUTABLE | ${definers.filter((r) => r.cannotWrite).length} | **cannot** modify data; Postgres enforces this |`);
say(`| SECURITY INVOKER | ${rows.length - definers.length} | RLS still applies, so exposure is bounded by policy |`);
say(`| named \`_internal\` | ${internal.length} | helpers never meant to be reachable from outside |`);
say(`| called from the client | ${clientCalled.length} | revoking without a grant-back breaks a screen |`);
say(`| **no caller found anywhere** | ${uncalled.length} | nothing to break; the safe first batch |`);
say();

say(`## The contradictions — highest priority`);
say();
say(`A G13 inventory entry declares who may call a function. Where that declared`);
say(`reader set is narrower than PUBLIC, the function is already contradicting`);
say(`itself: the inventory says "teacher only" and the grant says "everyone".`);
say();
if (contradictions.length === 0) {
  say(`None. Every PUBLIC-executable function is either undeclared or declared \`public\`.`);
  say(`That is not reassurance — ${rows.length - rows.filter((r) => r.declaredReaderSet).length} of these have no inventory entry at all.`);
} else {
  say(`**${contradictions.length} found.**`);
  say();
  say(`| function | declared | actual | definer | writes |`);
  say(`|---|---|---|---|---|`);
  for (const r of contradictions.slice(0, 60)) {
    say(`| \`${r.name}\` | ${r.declaredReaderSet} | PUBLIC | ${r.is_definer ? "yes" : "no"} | ${r.body_has_write_verb ? "yes" : r.cannotWrite ? "cannot" : "unreviewed"} |`);
  }
  if (contradictions.length > 60) say(`| ... and ${contradictions.length - 60} more | | | | |`);
}
say();

say(`## Suggested batches`);
say();
say(`Ordered so that the batch with the least ability to break a screen goes first`);
say(`and the one most likely to goes last, when the pattern is proven.`);
say();
const b1 = uncalled.filter((r) => r.internalName);
const b2 = uncalled.filter((r) => !r.internalName);
const b3 = clientCalled.filter((r) => r.is_definer);
const b4 = clientCalled.filter((r) => !r.is_definer);
say(`| batch | what | count | risk if wrong |`);
say(`|---|---|---|---|`);
say(`| 1 | \`_internal\` helpers with no caller | ${b1.length} | none found — nothing calls them |`);
say(`| 2 | other functions with no caller | ${b2.length} | a caller the grep missed (dynamic name, edge function) |`);
say(`| 3 | client-called DEFINERS | ${b3.length} | a screen breaks; these need an explicit grant-back |`);
say(`| 4 | client-called invokers | ${b4.length} | a screen breaks; RLS already bounds them |`);
say();
say(`The grep finds \`.rpc("name")\` literals only. A call built from a variable`);
say(`would not be found, so "no caller" means "no caller I could see" — which is`);
say(`why batch 2 is separated from batch 1 rather than merged into it.`);
say();

if (FULL) {
  say(`## Every function`);
  say();
  say(`| function | definer | volatility | writes | declared | callers |`);
  say(`|---|---|---|---|---|---|`);
  for (const r of rows) {
    say(
      `| \`${r.signature.replace(/\|/g, "\\|")}\` | ${r.is_definer ? "**yes**" : "no"} | ${VOL[r.volatility] ?? r.volatility} | ` +
        `${r.body_has_write_verb ? "**verb found**" : r.cannotWrite ? "cannot" : "unreviewed"} | ` +
        `${r.declaredReaderSet ?? "—"} | ${r.callers.length || "none found"} |`,
    );
  }
  say();
}

say(`## What this report does NOT establish`);
say();
say(`- That a function without a write verb is safe. Volatility is a promise the`);
say(`  author made; only STABLE/IMMUTABLE is checked by Postgres.`);
say(`- That "no caller found" means unreachable. The grep sees literal`);
say(`  \`.rpc("name")\` only.`);
say(`- That any definer fences itself. G13's rule stands: verify by CALLING as`);
say(`  each role, never by reading the body. That is verification item 3, and it`);
say(`  cannot be answered from this table.`);

const text = L.join("\n") + "\n";
if (OUT) {
  writeFileSync(OUT, text, "utf8");
  console.log(`written to ${OUT} (${rows.length} functions)`);
} else {
  console.log(text);
}
