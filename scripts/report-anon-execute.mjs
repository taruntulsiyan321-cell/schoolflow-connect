/**
 * Chunk 9.5 batch 3 — the population, computed from the database.
 *
 *   node scripts/report-anon-execute.mjs
 *   node scripts/report-anon-execute.mjs --list <CLASS>
 *
 * BATCH 3'S SUBJECT IS `anon`, NOT `authenticated`.
 *
 * Batches 1 and 2 asked "who calls this at all". That question is answered: the
 * functions with no caller are closed. What remains is a different question with
 * a different answer, and stating it plainly is most of the work:
 *
 *   `anon` is the role a browser holds BEFORE anyone signs in. The anon key is
 *   in the client bundle, so it is public. Every function `anon` can EXECUTE is
 *   reachable by anyone on the internet with a copy of the app.
 *
 * These are SECURITY DEFINER functions that fence themselves on auth.uid(), and
 * auth.uid() is NULL for anon — so most of them refuse. G13 exists because that
 * reasoning was wrong five times. A grant is a fence; a body is an argument.
 *
 * THE DEFERRED-FAILURE CLASS, AGAIN, AIMED AT A DIFFERENT ROLE
 *
 * Batch 2's near-miss was RLS policies calling same_school() as `authenticated`.
 * The same trap is loaded for `anon`: 108 policies in public are declared
 * `TO authenticated, anon`, and 69 more apply to ALL roles. Every RESTRICTIVE
 * tenancy fence is one of them. Revoke `same_school` from anon and an anon read
 * of those tables stops returning zero rows and starts returning
 * "permission denied for function same_school" — a 500 where there was a clean
 * empty result, reported by nothing at revoke time.
 *
 * So the policy class is computed here against the policies that actually apply
 * to anon, not against policies in general.
 *
 * WHAT THE CLASSES MEAN
 *
 *   EXTENSION      owned by an extension (pgvector). Invoked by operators and
 *                  index handlers, never by name. Out of scope, as in batch 2.
 *   POLICY_ANON    named in the expression of a policy that applies to anon or
 *                  to ALL roles. Revoking breaks reads that currently succeed.
 *   TRIGGER        fired by a trigger. EXECUTE is NOT checked when a trigger
 *                  fires, so these need no grant at all — they are IN scope.
 *   DEFAULT_EXPR   named in a column DEFAULT. Evaluated as the INSERTing role.
 *   INDEX_OR_CHECK named in an index expression or a CHECK constraint.
 *   INVOKER_CALLEE called from the body of a SECURITY INVOKER function that
 *                  anon can itself execute — the inner call is checked against
 *                  the end user.
 *   SIGNED_OUT     referenced by client code that runs before a session exists.
 *                  These genuinely need anon and must keep it.
 *   VERIFY_SUITE   called by a verification file. Those files call as
 *                  `authenticated`, so an anon-only revoke does not touch them —
 *                  carried through explicitly rather than assumed, because
 *                  assuming it is how batch 2 rotted five files.
 *
 * Anything left over is batch 3: revoke PUBLIC and anon, keep authenticated.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { queryRows, describeConnection, closeConnection } from "./lib/readonly-db.mjs";

const argv = process.argv.slice(2);
const LIST = (() => {
  const i = argv.indexOf("--list");
  return i >= 0 && argv[i + 1] ? argv[i + 1].toUpperCase() : null;
})();

// ── The catalog ────────────────────────────────────────────────────────────
const funcs = await queryRows(`
  SELECT p.oid::regprocedure::text AS signature,
         p.proname                 AS name,
         p.prosecdef               AS is_definer,
         p.prokind                 AS kind,
         pg_get_function_result(p.oid) = 'trigger' AS returns_trigger,
         EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
                    AND d.deptype = 'e')            AS from_extension,
         has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
         EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')  AS public_grant,
         EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                  WHERE a.grantee = 'anon'::regrole AND a.privilege_type = 'EXECUTE') AS anon_explicit
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
   ORDER BY p.proname
`);

// Policy expressions, but ONLY those that apply to anon (named, or ALL roles).
const anonPolicyText = (await queryRows(`
  SELECT coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND (p.polroles = '{0}' OR 'anon'::regrole = ANY(p.polroles))
`)).map((r) => r.expr).join("\n");

const triggerFns = new Set((await queryRows(`
  SELECT DISTINCT p.proname AS name
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
`)).map((r) => r.name));

const defaultExprText = (await queryRows(`
  SELECT pg_get_expr(ad.adbin, ad.adrelid) AS expr
    FROM pg_attrdef ad JOIN pg_class c ON c.oid = ad.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
`)).map((r) => r.expr).join("\n");

const indexCheckText = [
  ...(await queryRows(`
    SELECT pg_get_indexdef(i.indexrelid) AS expr
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND i.indexprs IS NOT NULL
  `)).map((r) => r.expr),
  ...(await queryRows(`
    SELECT pg_get_constraintdef(o.oid) AS expr
      FROM pg_constraint o JOIN pg_namespace n ON n.oid = o.connamespace
     WHERE n.nspname = 'public' AND o.contype = 'c'
  `)).map((r) => r.expr),
].join("\n");

// Bodies of SECURITY INVOKER functions that anon can execute: an inner call
// from one of those is checked against anon.
const invokerBodies = (await queryRows(`
  SELECT p.prosrc AS src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND NOT p.prosecdef AND p.prokind IN ('f','p')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
`)).map((r) => r.src).join("\n");

// ── Text corpora from the repository ───────────────────────────────────────
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)) out.push(p);
  }
  return out;
}
const clientFiles = [...walk("src"), ...walk("supabase/functions")];
const clientText = clientFiles.map((f) => readFileSync(f, "utf8")).join("\n");

const VERIFY_DIR = "supabase/migrations/verification";
const verifyText = readdirSync(VERIFY_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(VERIFY_DIR, f), "utf8"))
  .join("\n");
// ── What a signed-out browser can reach ────────────────────────────────────
//
// This class decides which grants survive, so how it is computed matters more
// than the number it produces. Two methods were tried and discarded before the
// one below, and both failed in the direction that looks clean:
//
//   1. FILE-PATH GLOBS over "public-looking" page names. Missed
//      ResetPassword.tsx, which is a public route. A function needed only by
//      password reset would have been revoked.
//
//   2. TRANSITIVE IMPORT CLOSURE from the public routes. src/App.tsx is both an
//      entry point and the router, so following it reached every dashboard
//      through `lazy(() => import(...))`. Blocking the five <ProtectedRoute>
//      components was not enough either — shared UI pulls in shared services, so
//      a teacher-only write still landed inside the "public" closure. The
//      closure said 127 signed-out functions and left a batch of 1: a clean
//      report from a blind gate.
//
//      Being in the import graph is not being callable before sign-in. The
//      instrument was measuring the wrong thing.
//
// MEASURED INSTEAD. The dev server was driven to each of the three public routes
// declared in src/App.tsx with storage cleared, and the network log read:
//
//   /                 Landing            0 requests to the Supabase project
//   /auth             sign-in page       0 requests to the Supabase project
//   /reset-password   expired-link view  0 requests to the Supabase project
//
// The client's anon RPC surface is EMPTY. Sign-in runs through GoTrue
// (supabase.auth.signInWithPassword / signInWithOtp), which is not a function in
// `public`, and every RPC the app makes happens after a session exists — as
// `authenticated`.
//
// So the class is bounded by the files that CAN run before a session: the public
// pages themselves and the auth layer. Not their import closure — the code that
// actually executes pre-session. It is deliberately a little wider than the
// measurement (it keeps claim_signup_role, which runs as anon only on the branch
// where email confirmation is required and no session is issued), because the
// safe direction here is keeping a grant that may be unnecessary rather than
// revoking one that is not.
// Whole-word match. A bare-name search, not `.rpc("name")`: batch 2 lost 26
// functions to `(supabase.rpc as any)("rpc_start_session")`, where the cast sits
// between `.rpc` and the argument. src/pages/Auth.tsx calls claim_signup_role
// exactly that way, so the pattern is still live in this codebase.
const word = (n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(fromFile, "..", spec);
  else return null; // a package, not our source
  for (const cand of [
    base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
    join(base, "index.ts"), join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand.replace(/\\/g, "/");
  }
  return null;
}

const PRE_SESSION_FILES = [
  "src/pages/Index.tsx",
  "src/pages/Landing.tsx",
  "src/pages/Auth.tsx",
  "src/pages/ResetPassword.tsx",
  "src/pages/NotFound.tsx",
  "src/hooks/useAuth.tsx",
  "src/integrations/supabase/client.ts",
  ...walk("src/auth"),
];

// The public routes are read out of App.tsx rather than listed, so a new
// unguarded route cannot silently fall outside this set.
const appSrc = readFileSync("src/App.tsx", "utf8");
const routedPublic = [...appSrc.matchAll(
  /<Route\s+path="([^"]+)"\s+element=\{<([A-Z][A-Za-z0-9_]*)\s*\/>\}/g,
)].map((m) => m[2]);
if (routedPublic.length === 0) {
  console.error(
    "No unguarded <Route path=… element={<X/>}> found in src/App.tsx. Either the router changed shape\n" +
    "or this pattern rotted — and either way every page would look protected and batch 3 would over-revoke.",
  );
  process.exit(2);
}
for (const name of routedPublic) {
  const m = appSrc.match(new RegExp(`import\\s+${name}\\s+from\\s+["']([^"']+)["']`));
  const r = m ? resolveImport(m[1], "src/App.tsx") : null;
  if (r && !PRE_SESSION_FILES.includes(r)) {
    console.error(
      `src/App.tsx routes ${name} without <ProtectedRoute>, and ${r} is not in PRE_SESSION_FILES.\n` +
      "A new public route has appeared since this list was measured. Re-measure the anon surface\n" +
      "on that route before running batch 3 against it.",
    );
    process.exit(2);
  }
}

const signedOutFiles = PRE_SESSION_FILES.filter((f) => existsSync(f));
const signedOutText = signedOutFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// ── This gate's own negative control ──────────────────────────────────────
// The closure is the whole basis for "needs anon". If it silently widens, every
// function looks public and batch 3 empties out — a clean report from a blind
// gate. Two fixed probes, one in each direction, asserted every run:
//
//   must be OUTSIDE   rpc_bulk_upsert_attendance — a teacher write, reachable
//                     only from /teacher/*, behind ProtectedRoute
//   must be INSIDE    signInWithPassword — the sign-in call itself, which is on
//                     the public /auth route by definition
const PRE_SESSION_MUST_EXCLUDE = "rpc_bulk_upsert_attendance";
const PRE_SESSION_MUST_INCLUDE = "signInWithPassword";
if (word(PRE_SESSION_MUST_EXCLUDE).test(signedOutText)) {
  console.error(
    `Pre-session self-test FAILED: ${PRE_SESSION_MUST_EXCLUDE} is inside the signed-out closure.\n` +
    "It is only reachable from a ProtectedRoute, so the closure has run past the guard and\n" +
    "every count below would be wrong in the direction that looks clean. Refusing to report.",
  );
  process.exit(2);
}
if (!word(PRE_SESSION_MUST_INCLUDE).test(signedOutText)) {
  console.error(
    `Pre-session self-test FAILED: ${PRE_SESSION_MUST_INCLUDE} is NOT inside the signed-out closure.\n` +
    "The sign-in call is on a public route by definition, so the closure is too narrow and\n" +
    "batch 3 would revoke something the login page needs. Refusing to report.",
  );
  process.exit(2);
}


// ── Classify ───────────────────────────────────────────────────────────────
const CLASSES = [
  "EXTENSION", "POLICY_ANON", "TRIGGER", "DEFAULT_EXPR", "INDEX_OR_CHECK",
  "INVOKER_CALLEE", "SIGNED_OUT", "BATCH3",
];
const buckets = Object.fromEntries(CLASSES.map((c) => [c, []]));

const inScope = funcs.filter((f) => f.anon_x);
for (const f of inScope) {
  const w = word(f.name);
  let cls;
  if (f.from_extension) cls = "EXTENSION";
  else if (w.test(anonPolicyText)) cls = "POLICY_ANON";
  else if (triggerFns.has(f.name) || f.returns_trigger) cls = "TRIGGER";
  else if (w.test(defaultExprText)) cls = "DEFAULT_EXPR";
  else if (w.test(indexCheckText)) cls = "INDEX_OR_CHECK";
  else if (w.test(invokerBodies)) cls = "INVOKER_CALLEE";
  else if (w.test(signedOutText)) cls = "SIGNED_OUT";
  else cls = "BATCH3";
  buckets[cls].push(f);
}

// ── The verification suite is carried THROUGH, not excluded ────────────────
//
// Batch 2 lost twelve functions to this class and the instinct is to subtract it
// again. That would be wrong here, and the difference is worth stating rather
// than inheriting: those twelve broke because the suite CALLS them, as
// `authenticated`. Batch 3 revokes `anon` and `PUBLIC` and leaves every
// `authenticated` grant standing, so a call made as `authenticated` is untouched.
//
// Subtracting the class anyway would leave that many functions reachable by the
// whole internet for a reason that does not apply.
//
// Two things have to be true for that to hold, and both are checked rather than
// assumed:
//   a. no verification file calls anything as `anon`
//   b. no verification file ASSERTS that anon still holds EXECUTE on something
//      batch 3 revokes — a catalog assertion rots just as loudly as a call
const verifyCalls = buckets.BATCH3.filter((f) => word(f.name).test(verifyText));
const setsRoleAnon = /SET\s+(LOCAL\s+)?ROLE\s+anon\b/i.test(verifyText);
const anonPrivAssertions = [...verifyText.matchAll(
  /has_function_privilege\(\s*'anon'[^)]*\)/gi,
)].map((m) => m[0]);
const anonAssertionCollisions = buckets.BATCH3.filter((f) =>
  anonPrivAssertions.some((a) => word(f.name).test(a)),
);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(describeConnection());
console.log("");
console.log(`public functions                              ${funcs.length}`);
console.log(`  EXECUTE-able by anon                        ${inScope.length}   <- batch 3's population`);
console.log(`  EXECUTE-able by authenticated               ${funcs.filter((f) => f.auth_x).length}`);
console.log(`  still holding an explicit PUBLIC grant      ${funcs.filter((f) => f.public_grant).length}`);
console.log("");
console.log("EXCLUSIONS, each a named class with its count:");
let running = inScope.length;
for (const c of CLASSES.slice(0, -1)) {
  running -= buckets[c].length;
  console.log(`  -${String(buckets[c].length).padStart(4)}  ${c.padEnd(15)} ${buckets[c].length ? buckets[c].slice(0, 3).map((f) => f.name).join(", ") + (buckets[c].length > 3 ? ", …" : "") : ""}`);
}
console.log(`  ${"".padStart(5)}  ${"-".repeat(40)}`);
console.log(`   ${String(buckets.BATCH3.length).padStart(4)}  BATCH 3 — revoke PUBLIC + anon, keep authenticated`);
console.log("");
const b3 = buckets.BATCH3;
console.log(`  of those: ${b3.filter((f) => f.is_definer).length} SECURITY DEFINER, ${b3.filter((f) => !f.is_definer).length} INVOKER`);
console.log(`            ${b3.filter((f) => f.auth_x).length} keep an authenticated grant, ${b3.filter((f) => !f.auth_x).length} would be left callable by nobody`);
console.log("");
console.log("CARRIED THROUGH, not subtracted:");
console.log(`   ${String(verifyCalls.length).padStart(4)}  VERIFY_SUITE    called by a verification file — as \`authenticated\`, which`);
console.log(`         ${" ".repeat(15)} batch 3 does not touch. Subtracting them would leave`);
console.log(`         ${" ".repeat(15)} them open to the internet for a reason that does not apply.`);
console.log(`     ${setsRoleAnon ? "!!" : "ok"}  no verification file calls anything as \`anon\`` +
  (setsRoleAnon ? "  <- FALSE. The premise above does not hold." : ""));
console.log(`     ${anonAssertionCollisions.length ? "!!" : "ok"}  no verification file asserts anon still holds EXECUTE on a batch-3 name` +
  (anonAssertionCollisions.length ? `  <- ${anonAssertionCollisions.map((f) => f.name).join(", ")}` : ""));

// The whole question asked at once. A rotted verification file reports only its
// FIRST failure, so discovering these one re-run at a time converges slowly and
// looks like progress while the population is still unknown.
if (setsRoleAnon || anonAssertionCollisions.length) {
  console.log("\nBATCH 3 IS NOT SAFE TO APPLY AS COMPUTED — resolve the above first.");
  process.exitCode = 1;
}

if (LIST) {
  if (!buckets[LIST]) {
    console.error(`\nUnknown class ${LIST}. One of: ${CLASSES.join(", ")}`);
    process.exitCode = 2;
  } else {
    console.log(`\n── ${LIST} (${buckets[LIST].length}) ──`);
    for (const f of buckets[LIST]) {
      console.log(`  ${f.is_definer ? "DEFINER " : "invoker "}${f.signature}`);
    }
  }
}

await closeConnection();
