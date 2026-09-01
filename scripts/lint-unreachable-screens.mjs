/**
 * CHUNK 10 — which screens can a role actually reach?
 *
 *   node scripts/lint-unreachable-screens.mjs
 *   node scripts/lint-unreachable-screens.mjs --self-test
 *   node scripts/lint-unreachable-screens.mjs --list
 *
 * WHY THIS EXISTS, and it is a mistake I made twice before writing it.
 *
 * "Check every screen a role can reach, not the ones the code contains."
 *
 * Batch 1 reported a live contradiction in NeedsAttentionBlock — attendance
 * flagged at 75 while the module says 80. Batch 3 fixed the same thing in
 * ChronicAbsenteesBlock. Both are real defects and NEITHER WAS REACHABLE: all
 * six components under dashboard-blocks/ are rendered only by
 * PrincipalDashboard, which no route points at. Two batches of careful work on
 * screens nobody can open, reported as though they were live.
 *
 * The reverse error is the dangerous one and it is the same blindness: a screen
 * that IS reachable and was never checked because it did not appear in a grep.
 *
 * WHY AN IMPORT CLOSURE IS THE RIGHT INSTRUMENT HERE, having been the wrong one
 * before. Chunk 9.5 tried to decide "callable before sign-in" from the import
 * graph and it failed, because being bundled is not being executed — that was a
 * RUNTIME question. "Reachable from a route" is a different question and it is
 * genuinely structural: a component no routed page transitively imports cannot
 * render, whatever happens at runtime. The closure answers the question it is
 * being asked this time.
 *
 * It over-reports reachability, never under-reports: a component imported but
 * conditionally never rendered still counts as reachable here. That is the safe
 * direction — this gate is for finding DEAD screens, and calling a dead one live
 * costs a wasted look, while calling a live one dead means it never gets checked.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const LIST = argv.includes("--list");

/** Every router in the app. A route declared in any of these is an entry point. */
const ROUTERS = [
  "src/App.tsx",
  "src/gurukul-principal/PrincipalApp.tsx",
  "src/gurukul-admin/AdminApp.tsx",
  "src/gurukul-teacher/TeacherApp.tsx",
  "src/gurukul-parent/ParentApp.tsx",
  "src/gurukul/GurukulApp.tsx",
];

/** Directories that hold screens. A file here that nothing routes to is dead. */
const SCREEN_DIRS = [
  "src/pages",
  "src/gurukul-principal",
  "src/gurukul-admin",
  "src/gurukul-teacher",
  "src/gurukul-parent",
  "src/gurukul",
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "dist" || e === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(fromFile, "..", spec);
  else return null;
  for (const cand of [
    base, `${base}.ts`, `${base}.tsx`,
    join(base, "index.ts"), join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand.replace(/\\/g, "/");
  }
  return null;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** Everything transitively imported from the routers. */
export function reachableFrom(entries) {
  const seen = new Set();
  const queue = entries.filter((f) => existsSync(f));
  while (queue.length) {
    const f = queue.pop().replace(/\\/g, "/");
    if (seen.has(f)) continue;
    seen.add(f);
    let src;
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolveImport(m[1], f);
      if (r && !seen.has(r)) queue.push(r);
    }
  }
  return seen;
}

if (SELF_TEST) {
  let bad = 0;
  const say = (okCase, name, extra = "") => {
    if (!okCase) bad += 1;
    console.log(`  ${okCase ? "ok   " : "FAIL "} ${name}${extra}`);
  };

  // The gate must have INPUTS: real routers, real screens.
  const routersPresent = ROUTERS.filter((f) => existsSync(f));
  say(routersPresent.length > 0, `the gate has inputs: ${routersPresent.length} router(s) found`);
  const screens = SCREEN_DIRS.flatMap((d) => walk(d));
  say(screens.length > 0, `and ${screens.length} screen file(s) in scope`);

  const reach = reachableFrom(routersPresent);
  say(reach.size > 10, `the closure resolved ${reach.size} file(s)`);

  // A KNOWN-REACHABLE control: the router reaches the app's own entry pages.
  const known = "src/pages/Auth.tsx";
  say(!existsSync(known) || reach.has(known), `known-reachable control: ${known}`);

  // A KNOWN-UNREACHABLE control: a path that does not exist must not be reported
  // reachable, or the closure is matching on something other than imports.
  say(!reach.has("src/pages/DoesNotExist.tsx"), "known-unreachable control: a file that does not exist");

  console.log(
    bad === 0
      ? "\nall 5 self-test case(s) behaved. The closure is reading real routers and\nresolving real imports."
      : `\n${bad} self-test case(s) FAILED. Do not trust this gate's output.`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
} else {
  const routers = ROUTERS.filter((f) => existsSync(f));
  if (routers.length === 0) {
    console.error("no routers found — refusing to report every screen as dead");
    process.exit(1);
  }
  const reach = reachableFrom(routers);
  const screens = SCREEN_DIRS.flatMap((d) => walk(d));
  if (screens.length === 0) {
    console.error("no screen files found — refusing to report that as clean");
    process.exit(1);
  }

  const dead = screens.filter((f) => !reach.has(f)).sort();

  console.log(
    `${routers.length} router(s), ${screens.length} screen file(s), ` +
      `${reach.size} file(s) reachable by import from a routed entry point.`,
  );

  if (dead.length === 0) {
    console.log("\nevery screen file is reachable from a router.");
  } else {
    const byDir = new Map();
    for (const f of dead) {
      const d = f.slice(0, f.lastIndexOf("/"));
      byDir.set(d, [...(byDir.get(d) ?? []), f.slice(d.length + 1)]);
    }
    console.log(
      `\n${dead.length} SCREEN FILE(S) NO ROUTE CAN REACH.\n\n` +
        `Not necessarily wrong — but a defect fixed here is not a defect fixed for\n` +
        `anyone, and a defect FOUND here should not be reported as live.\n`,
    );
    for (const [d, files] of [...byDir.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${d}/  (${files.length})`);
      if (LIST) for (const f of files) console.log(`      ${f}`);
    }
    if (!LIST) console.log("\n  --list for filenames");
  }
}
