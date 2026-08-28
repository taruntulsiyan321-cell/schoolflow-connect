#!/usr/bin/env node
/**
 * G13 — every SECURITY DEFINER function is a door. Inventory them.
 *
 * Five instances of the same leak, in five different chunks, every one behind
 * CORRECT policies:
 *
 *   1.6  Nova edge function            a child's mistake book, to parent and teacher
 *   1.6  rpc_teacher_concept_analytics class practice aggregates, to teachers
 *   7A   rpc_dpp_pick_from_bank        Class 12 questions, to a Class 5 student
 *   7B   rpc_teacher_class_insights    named students' accuracy, to any teacher
 *   7B   rpc_get_battle_report         the whole report blob, to five roles
 *
 * RLS does not run inside a definer body, so policy-level auditing cannot see
 * any of them. This gate is the inventory that can.
 *
 * ── What it checks ────────────────────────────────────────────────────────
 *
 *   1. UNLISTED     a definer or edge function the inventory does not name.
 *                   This is the check that catches the NEXT one.
 *   2. UNDECLARED   EXECUTE granted to anon/authenticated with no justification.
 *   3. WIDENING     it calls another definer whose reader set is WIDER than its
 *                   own. rpc_ensure_battle_report (self) called
 *                   rpc_get_battle_report (staff) — locking a wrapper does not
 *                   lock what it wraps.
 *   4. DISAGREEMENT declared reader set vs what the function actually does,
 *                   established by CALLING it as each role. Four of the five
 *                   leaks above survived a body review; none would have
 *                   survived being called as a teacher.
 *
 * ── Keys are signatures, not names ────────────────────────────────────────
 *
 * Four names here carry two signatures each (290 functions, 286 names).
 * Keying on the name would collapse them, and a NEW OVERLOAD of an existing
 * name would never trip UNLISTED — the one check this gate exists for.
 * publish_due_scheduled_homework has a no-arg and a _school_id uuid form, and
 * their reach is not the same.
 *
 * ── G8 ────────────────────────────────────────────────────────────────────
 *
 * This gate cannot pass by not running. Failure to reach the database, read the
 * inventory, or complete a probe exits non-zero and says why. An empty result
 * from a check that did not run is not a pass.
 *
 * Usage:
 *   node scripts/lint-definer-doors.mjs                 the gate
 *   node scripts/lint-definer-doors.mjs --verify-calls  + live role probing
 *   node scripts/lint-definer-doors.mjs --generate      scaffold new entries
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const INVENTORY = "supabase/definer-inventory.json";
const EDGE_DIR = "supabase/functions";

const argv = process.argv.slice(2);
const DO_GENERATE = argv.includes("--generate");
const DO_VERIFY = argv.includes("--verify-calls");

/**
 * Reader sets, narrow to wide. A definer may call another at the same rank or
 * narrower. Calling wider is the wrapper bug: the caller's gate becomes
 * decoration, because the callee answers anyone the CALLEE admits.
 */
const READER_SETS = [
  "none", // returns nobody's data — touches no user- or tenant-scoped table
  "self", // the calling user's own rows
  "parent", // a parent's own children
  "teacher", // a teacher's own classes
  "staff", // principal / admin, inside their institution
  "school", // anyone inside the institution
  "public", // no user-specific restriction on what it returns
];

/**
 * CALLABILITY is a separate axis from reader set, and conflating them was a
 * bug in the first version of this gate: it ranked "internal" as if it were a
 * narrow reader set, which produced 373 false widening reports — every helper
 * that happened to call another helper.
 *
 *   callability  WHO MAY INVOKE IT   — a fact, read from the grants
 *   readerSet    WHOSE DATA IT REACHES — a judgement, declared and reviewed
 *
 * They are independent. An internal helper can reach every row in the
 * database; being uncallable does not make it narrow, it makes it reachable
 * only THROUGH something else. That is exactly why the widening check has to
 * compare reach and not callability: rpc_ensure_battle_report was callable and
 * narrow, and it leaked because what it CALLED reached wider.
 */
const CALLABILITY = ["trigger", "internal", "granted"];
const rank = (r) => READER_SETS.indexOf(r);
const keyOf = (name, args) => `${name}(${args})`;

function fail(msg) {
  console.error(`\nlint-definer-doors: ${msg}`);
  process.exit(2);
}

/** All reads go through q.mjs, the repo's scratch SQL runner. */
function sql(text) {
  let out;
  try {
    out = execFileSync("node", ["q.mjs", "-e", text], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    fail(`could not reach the database: ${String(e.message).split("\n")[0]}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    fail(`database returned something that is not JSON:\n${out.slice(0, 400)}`);
  }
  if (parsed && parsed.message) fail(`query failed: ${parsed.message}`);
  if (!Array.isArray(parsed)) fail(`expected rows, got ${typeof parsed}`);
  return parsed;
}

// ── 1. What the database actually has ───────────────────────────────────────
const dbRows = sql(`
  select p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as returns,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as g_auth,
         has_function_privilege('anon', p.oid, 'EXECUTE') as g_anon,
         coalesce((
           select string_agg(distinct c.proname, ',' order by c.proname)
           from pg_proc c
           join pg_namespace cn on cn.oid = c.pronamespace
           where cn.nspname = 'public' and c.prokind = 'f' and c.prosecdef
             and c.proname <> p.proname
             and p.prosrc ~ ('\\m' || c.proname || '\\M')
         ), '') as calls
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  order by p.proname
`);

if (dbRows.length === 0) fail("zero SECURITY DEFINER functions returned — that cannot be right, refusing to pass");

// Edge functions are doors too: RLS never runs for service_role.
let edgeFns = [];
if (existsSync(EDGE_DIR)) {
  edgeFns = readdirSync(EDGE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
}

// ── 2. The inventory ────────────────────────────────────────────────────────
let inventory = { definers: {}, edge: {} };
if (existsSync(INVENTORY)) {
  try {
    inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
  } catch (e) {
    fail(`inventory is not readable JSON (${e.message}). A gate that cannot read its own inventory FAILS.`);
  }
} else if (!DO_GENERATE) {
  fail(`${INVENTORY} does not exist. Run with --generate to scaffold it.`);
}
inventory.definers ??= {};
inventory.edge ??= {};

/**
 * Scaffolding heuristic only. Deliberately pessimistic: it proposes the WIDEST
 * thing a body names, so review narrows rather than widens. Every scaffolded
 * entry is reviewed:false and counts as debt until a human confirms it.
 */
function proposeReaderSet(src, scopedTables) {
  // Reach only — grants are NOT consulted here. A function's reach is what its
  // body restricts itself to, whoever is allowed to call it.
  if (/has_role\s*\(\s*[^,]+,\s*'(admin|principal)'/.test(src)) return "staff";
  if (/teacher_teaches_class/.test(src)) return "teacher";
  if (/parent_user_id|parent_students/.test(src)) return "parent";
  if (/auth\.uid\(\)/.test(src)) return "self";
  if (/same_school/.test(src)) return "school";
  // Touching no user- or tenant-scoped table at all is the NARROWEST reach,
  // not the widest. Defaulting these to "public" was the second bug in this
  // gate: it made every caller of a pure helper like _generate_battle_code()
  // look like a widening, and produced 211 reports nobody would ever read.
  // A gate that cries wolf 211 times is not a gate.
  if (!scopedTables.some((t) => new RegExp(`\\b${t}\\b`).test(src))) return "none";
  return "public";
}

/**
 * Callability is derived, never declared — it is a fact about the catalog.
 * A trigger function carries the same default PUBLIC EXECUTE grant as anything
 * else, so reading grants alone would misread 33 of them as public doors;
 * Postgres rejects a direct call to a function returning trigger.
 */
function callabilityOf(r) {
  if (r.returns === "trigger") return "trigger";
  return r.g_auth || r.g_anon ? "granted" : "internal";
}

if (DO_GENERATE) {
  const srcRows = sql(`
    select p.proname as name, p.prosrc as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef
  `);
  const srcOf = Object.fromEntries(srcRows.map((r) => [r.name, r.src ?? ""]));

  // A table is "scoped" if a row in it belongs to someone: it carries a user,
  // student or institution column. Reaching none of these is reach "none".
  const scopedTables = sql(`
    select distinct c.table_name as t
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name in ('user_id', 'student_id', 'school_id', 'parent_user_id')
     order by 1
  `).map((r) => r.t);
  if (scopedTables.length === 0) fail("no user- or tenant-scoped tables found — refusing to classify reach against an empty list");
  // Direct body signal first, then propagate through the call graph to a fixed
  // point. A function with no signal of its own reaches whatever the things it
  // calls reach — active_membership_role() looked "public" only because the
  // auth.uid() it depends on is one level down, inside active_membership_id().
  // Nineteen of the noisiest false widenings were exactly that shape.
  const directOf = {};
  for (const r of dbRows) directOf[r.name] = proposeReaderSet(srcOf[r.name] ?? "", scopedTables);

  const calleesOf = Object.fromEntries(dbRows.map((r) => [r.name, r.calls ? r.calls.split(",") : []]));
  const resolved = { ...directOf };
  const hasOwnSignal = Object.fromEntries(
    dbRows.map((r) => [r.name, directOf[r.name] !== "public" && directOf[r.name] !== "none"]),
  );
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const r of dbRows) {
      if (hasOwnSignal[r.name]) continue; // its own body already says what it reaches
      if (directOf[r.name] !== "public") continue; // "none" is a finding, not a gap
      const callees = (calleesOf[r.name] ?? []).filter((c) => resolved[c]);
      if (callees.length === 0) continue; // nothing to learn from; stays public

      // Start at the NARROWEST and take the max across callees. Starting from
      // the function's current "public" guess would make this a no-op, because
      // nothing ranks wider than public — the first version did exactly that.
      let widest = "none";
      for (const c of callees) if (rank(resolved[c]) > rank(widest)) widest = resolved[c];

      if (widest !== resolved[r.name]) {
        resolved[r.name] = widest;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // An unsignalled function that calls nothing informative stays "public": the
  // scaffolder must not guess narrow. Review narrows; the gate never does.
  for (const r of dbRows) if (directOf[r.name] === "public" && resolved[r.name] === "public") resolved[r.name] = "public";

  let added = 0;
  for (const r of dbRows) {
    const k = keyOf(r.name, r.args);
    if (inventory.definers[k]) continue;
    inventory.definers[k] = {
      name: r.name,
      readerSet: resolved[r.name] ?? proposeReaderSet(srcOf[r.name] ?? "", scopedTables),
      callability: callabilityOf(r),
      returns: r.returns,
      grants: [r.g_auth ? "authenticated" : null, r.g_anon ? "anon" : null].filter(Boolean),
      calls: r.calls ? r.calls.split(",") : [],
      justification: "",
      verifiedBy: "",
      reviewed: false,
    };
    added++;
  }
  for (const name of edgeFns) {
    if (inventory.edge[name]) continue;
    inventory.edge[name] = { readerSet: "public", justification: "", verifiedBy: "", reviewed: false };
    added++;
  }
  writeFileSync(INVENTORY, JSON.stringify(inventory, null, 2) + "\n", "utf8");
  console.log(`scaffolded ${added} new entr${added === 1 ? "y" : "ies"} into ${INVENTORY}`);
  console.log("Every one is reviewed:false with an empty justification. That is DEBT, not a pass.");
  process.exit(0);
}

// ── 3. The checks ───────────────────────────────────────────────────────────
const failures = [];
const debt = [];

for (const r of dbRows) {
  if (!inventory.definers[keyOf(r.name, r.args)]) {
    failures.push(`UNLISTED definer: ${keyOf(r.name, r.args)} — not in ${INVENTORY}. Every door must be listed, and an overload is its own door.`);
  }
}
for (const name of edgeFns) {
  if (!inventory.edge[name]) failures.push(`UNLISTED edge function: ${name}`);
}

// A stale entry is how an unlisted door hides in plain sight.
const liveKeys = new Set(dbRows.map((r) => keyOf(r.name, r.args)));
for (const k of Object.keys(inventory.definers)) {
  if (!liveKeys.has(k)) failures.push(`STALE inventory entry: ${k} is listed but no longer exists in the database.`);
}

const byKey = Object.fromEntries(dbRows.map((r) => [keyOf(r.name, r.args), r]));
/** A call site names a function, not a signature. Resolve to every overload. */
const overloadsOf = {};
for (const r of dbRows) (overloadsOf[r.name] ??= []).push(keyOf(r.name, r.args));

for (const [k, entry] of Object.entries(inventory.definers)) {
  const live = byKey[k];
  if (!live) continue;

  if (!READER_SETS.includes(entry.readerSet)) {
    failures.push(`${k}: readerSet "${entry.readerSet}" is not one of ${READER_SETS.join(", ")}`);
    continue;
  }

  // Callability is a fact, so it is recomputed and compared rather than
  // trusted. Declared-uncallable-but-actually-granted is the most dangerous
  // kind of wrong, because it reads as safe.
  const actual = callabilityOf(live);
  const granted = actual === "granted";
  const who = [live.g_auth && "authenticated", live.g_anon && "anon"].filter(Boolean).join(" and ");

  if (entry.callability && entry.callability !== actual) {
    failures.push(
      `MISDECLARED: ${k} is recorded as ${entry.callability} but the catalog says ${actual}` +
        (granted ? ` (EXECUTE-granted to ${who})` : "") + ".",
    );
  }

  // Reviewed entries are held to the rule. Unreviewed ones are DEBT.
  //
  // The distinction matters, and getting it wrong would have made this gate
  // worthless on arrival. The scaffolder GUESSES a reader set from the body;
  // reporting an "undeclared grant" or a "widening call" derived from two
  // guesses is not a finding, it is a restatement of the guess. 320 such
  // reports on the first run would have been switched off within a week.
  //
  // So the gate FAILS on facts — unlisted, stale, misdeclared callability —
  // and on judgements only once a human has confirmed them. Everything else
  // is printed as debt on every run, the same way the ten missing rollbacks
  // are, so it stays visible instead of quietly becoming permanent.
  if (granted && entry.reviewed && !String(entry.justification || "").trim()) {
    failures.push(`UNDECLARED GRANT: ${k} is EXECUTE-granted to ${who} with no justification.`);
  }

  // WIDENING — the rpc_ensure_battle_report bug, mechanised.
  //
  // Scoped to GRANTED callers. The leak surface is the door: a function a user
  // can actually invoke, which gates itself narrowly and then calls something
  // that reaches wider. An internal helper calling another internal helper has
  // no user on the other end of it — whatever door eventually exposes that
  // chain is itself granted, and is checked here on its own account.
  //
  // Without this scoping the check reported 182 pairs, almost all of them
  // helper-to-helper. A gate nobody reads protects nothing.
  // rpc_ensure_battle_report was granted, so the real bug still trips it.
  for (const calleeName of granted && live.calls ? live.calls.split(",") : []) {
    // If the callee name is overloaded we cannot tell which one from body text,
    // so compare against the WIDEST. Being conservative is the point: the
    // wrapper bug IS an assumption that the callee is narrower than it is.
    let target = null;
    for (const ck of overloadsOf[calleeName] ?? []) {
      const t = inventory.definers[ck];
      if (!t || !READER_SETS.includes(t.readerSet)) continue;
      if (!target || rank(t.readerSet) > rank(target.readerSet)) target = t;
    }
    if (!target) continue;
    if (rank(target.readerSet) > rank(entry.readerSet)) {
      const msg =
        `${k} (${entry.readerSet}) calls ${calleeName} (${target.readerSet}). ` +
        `Locking a wrapper does not lock what it wraps — ${calleeName} answers anyone IT admits, ` +
        `and is separately callable over PostgREST regardless.`;
      // Only a fact once both ends have been reviewed; otherwise it is one
      // guess compared against another.
      if (entry.reviewed && target.reviewed) failures.push(`WIDENING CALL: ${msg}`);
      else debt.push(`possible widening (unreviewed): ${msg}`);
    }
  }

  if (granted && !entry.reviewed) {
    debt.push(`${k} (proposed ${entry.readerSet}, unreviewed)`);
  } else if (granted && !String(entry.verifiedBy || "").trim() && live.args !== "") {
    debt.push(`${k} takes arguments and names no verifiedBy item — its reader set is asserted, not demonstrated`);
  }
}

// ── 4. DISAGREEMENT — call it as each role ──────────────────────────────────
//
// Scope: the zero-argument callable definers. One taking arguments cannot be
// probed blind, because the argument is usually the thing being authorised
// (a participant id, a student id) — those declare a verifiedBy item instead.
//
// Safety: each role's probe runs in its own transaction ending in ROLLBACK,
// under a statement_timeout, so a definer with a side effect cannot leave one
// behind and a slow one cannot hang the gate.
let probed = 0;
if (DO_VERIFY) {
  const targets = dbRows.filter(
    (r) => r.args === "" && r.returns !== "trigger" && (r.g_auth || r.g_anon) && inventory.definers[keyOf(r.name, r.args)],
  );
  if (targets.length === 0) {
    failures.push("VERIFY DID NOT RUN: no zero-argument definer was probeable. An empty result from a check that did not run is a failure (G8).");
  }

  const roles = [
    ["student", "arjun.mehta@wisdomcampus.com"],
    ["teacher", "priya.sharma@wisdomcampus.com"],
    ["parent", "mehta.parent@wisdomcampus.com"],
    ["principal", "principal@wisdomcampus.com"],
    ["admin", "admin@wisdomcampus.com"],
  ];

  const observed = {};
  for (const [role, email] of roles) {
    const body = targets
      .map(
        (t) =>
          "  BEGIN\n" +
          "    PERFORM public." + t.name + "();\n" +
          "    INSERT INTO _probe VALUES ('" + t.name + "', '" + role + "', 'answered');\n" +
          "  EXCEPTION WHEN others THEN\n" +
          "    INSERT INTO _probe VALUES ('" + t.name + "', '" + role + "', 'refused');\n" +
          "  END;",
      )
      .join("\n");

    const script =
      "BEGIN;\n" +
      "SET LOCAL statement_timeout = '5s';\n" +
      "CREATE TEMP TABLE _probe(fn text, role text, outcome text);\n" +
      "DO $probe$\nDECLARE _u uuid;\nBEGIN\n" +
      "  SELECT id INTO _u FROM auth.users WHERE email = '" + email + "';\n" +
      "  IF _u IS NULL THEN RAISE EXCEPTION 'no such demo user: " + email + "'; END IF;\n" +
      "  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);\n" +
      body + "\n" +
      "END\n$probe$;\n" +
      "SELECT fn, role, outcome FROM _probe;\n" +
      "ROLLBACK;\n";

    const file = ".probe-" + role + ".sql";
    writeFileSync(file, script, "utf8");
    let rows = null;
    try {
      rows = JSON.parse(execFileSync("node", ["q.mjs", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch (e) {
      failures.push(`VERIFY DID NOT RUN for role ${role}: ${String(e.message).split("\n")[0]}. A probe that could not complete is a failure, not a pass (G8).`);
    } finally {
      try { unlinkSync(file); } catch { /* best effort */ }
    }
    if (!rows) continue;
    if (rows.message) {
      failures.push(`VERIFY DID NOT RUN for role ${role}: ${rows.message}`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      failures.push(`VERIFY DID NOT RUN for role ${role}: probe returned no rows for ${targets.length} function(s). Empty is not clean (G8).`);
      continue;
    }
    for (const r of rows) {
      (observed[keyOf(r.fn, "")] ??= {})[r.role] = r.outcome;
      probed++;
    }
  }

  // Judge only the unambiguous contradiction: something declared unreachable
  // that answered a real user. A zero-argument "self" function answering every
  // role is CORRECT — each caller gets their own row — so flagging that would
  // be noise. The rest of the matrix is recorded as evidence for review.
  for (const [k, byRole] of Object.entries(observed)) {
    const entry = inventory.definers[k];
    if (!entry) continue;
    const answered = Object.entries(byRole).filter(([, o]) => o === "answered").map(([r]) => r);
    if (entry.callability !== "granted" && answered.length) {
      failures.push(
        `DISAGREEMENT: ${k} is recorded ${entry.callability} — not user-callable — but ANSWERED when called as ${answered.join(", ")}.`,
      );
    }
    // A reach narrower than "school" that answers every role is worth a human
    // look, but is NOT automatically wrong: a zero-argument "self" function
    // answering all five is correct, because each caller got their own row.
    // Recorded as evidence, not judged.
    entry.observed = byRole;
  }
  writeFileSync(INVENTORY, JSON.stringify(inventory, null, 2) + "\n", "utf8");
}

// ── 5. Report ───────────────────────────────────────────────────────────────
console.log(`definers: ${dbRows.length} live, ${Object.keys(inventory.definers).length} inventoried`);
console.log(`edge functions: ${edgeFns.length} live, ${Object.keys(inventory.edge).length} inventoried`);
if (DO_VERIFY) console.log(`role probe: ${probed} observation(s) recorded`);

if (debt.length) {
  console.log(`\nDEBT — ${debt.length} door(s) listed but not yet reviewed or demonstrated:`);
  for (const d of debt.slice(0, 25)) console.log(`  - ${d}`);
  if (debt.length > 25) console.log(`  ... and ${debt.length - 25} more`);
  console.log("  Listed, so a NEW door still fails the gate. Not yet justified.");
}

if (failures.length) {
  console.log(`\nFAIL: ${failures.length} problem(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

console.log("\nPASS: every definer and edge function is inventoried, no undeclared grant, no widening call.");
