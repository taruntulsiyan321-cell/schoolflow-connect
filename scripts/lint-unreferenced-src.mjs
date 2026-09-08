/**
 * Which files under `src/` are reachable from the app's entry point?
 *
 * WHY THIS AND NOT "grep for the filename". A file can be imported by a file
 * that nothing imports, and both look "referenced" to a grep. Reachability is a
 * graph question, so this walks the graph: start at the Vite entry, follow every
 * static and dynamic import, and report what it never arrives at.
 *
 * WHAT COUNTS AS AN ENTRY POINT
 *   - `index.html`'s script src (the real Vite entry)
 *   - every `*.test.ts(x)` — tests are run, not imported
 *   - `src/vite-env.d.ts` and other ambient declarations
 *   - anything `vitest.config.ts` names (setupFiles) — load-bearing by
 *     configuration, and invisible to the import graph
 * Anything reachable from those is KEPT. Everything else is a candidate.
 *
 * A CANDIDATE IS NOT A VERDICT. This prints what to look at; deleting is a
 * judgement each file has to earn. A UI kit component nothing imports today is
 * dead weight; a `.d.ts` that types a global is not, and neither is a file the
 * build tool picks up by convention. Read before removing.
 *
 *   node scripts/lint-unreferenced-src.mjs            list candidates
 *   node scripts/lint-unreferenced-src.mjs --json     machine-readable
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const EXTS = [".ts", ".tsx", ".js", ".jsx"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allFiles = walk(SRC).filter((f) =>
  [...EXTS, ".css", ".json", ".svg", ".png"].includes(extname(f)),
);
const codeFiles = allFiles.filter((f) => EXTS.includes(extname(f)));

/** Resolve an import specifier to a real file, or null if it is a package. */
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules / URL import

  const tries = [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, "index" + e)),
  ];
  for (const t of tries) {
    if (existsSync(t) && statSync(t).isFile()) return t;
  }
  return null;
}

/** Every import/export specifier in a file, static and dynamic. */
function specifiersOf(file) {
  const text = readFileSync(file, "utf8");
  const out = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) out.push(m[1]);
  }
  return out;
}

// ── entry points ────────────────────────────────────────────────────────────
const entries = new Set();

const html = join(ROOT, "index.html");
if (existsSync(html)) {
  const m = readFileSync(html, "utf8").match(/src=["']\/?(src\/[^"']+)["']/);
  if (m) {
    const p = join(ROOT, m[1]);
    if (existsSync(p)) entries.add(p);
  }
}
// Vitest's setupFiles: named in a config, never imported. This is the exact
// case a reachability scan gets wrong on its own — the file is load-bearing and
// nothing in the graph points at it.
const vitestConfig = join(ROOT, "vitest.config.ts");
if (existsSync(vitestConfig)) {
  const text = readFileSync(vitestConfig, "utf8");
  for (const m of text.matchAll(/["'](\.\/[^"']*?\.[jt]sx?)["']/g)) {
    const p = resolve(ROOT, m[1]);
    if (existsSync(p)) entries.add(p);
  }
}

// Tests are executed by vitest, not imported by the app.
for (const f of codeFiles) {
  if (/\.(test|spec)\.[jt]sx?$/.test(f)) entries.add(f);
  // Ambient declarations are picked up by tsconfig, never imported.
  if (f.endsWith(".d.ts")) entries.add(f);
}

if (entries.size === 0) {
  console.error("BLOCKED: no entry point found — index.html has no src/ script.");
  process.exitCode = 2;
}

// ── walk ────────────────────────────────────────────────────────────────────
const reached = new Set();
const stack = [...entries];
while (stack.length) {
  const file = stack.pop();
  if (reached.has(file)) continue;
  reached.add(file);
  if (!EXTS.includes(extname(file))) continue;
  for (const spec of specifiersOf(file)) {
    const target = resolveSpec(spec, file);
    if (target && !reached.has(target)) stack.push(target);
  }
}

const unreferenced = codeFiles
  .filter((f) => !reached.has(f))
  .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
  .sort();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total: codeFiles.length, reached: reached.size, unreferenced }, null, 2));
} else {
  // Counted as an INTERSECTION, not `reached.size`: the walk follows imports
  // out of `src/` too (a config, a sibling package entry), so the raw size can
  // exceed the number of files under src/ and read as nonsense.
  const reachedInSrc = codeFiles.filter((f) => reached.has(f)).length;
  console.log(
    `${reachedInSrc} of ${codeFiles.length} code file(s) under src/ are reachable ` +
      `from the entry point, the tests and vitest's setupFiles.\n`,
  );
  if (unreferenced.length === 0) {
    console.log("every file under src/ is reachable.");
  } else {
    console.log(`${unreferenced.length} file(s) nothing imports:\n`);
    for (const f of unreferenced) console.log("  " + f);
    console.log(
      "\nCandidates, not a verdict. Read each one before deleting — a file the\n" +
        "build picks up by convention is unreferenced and still load-bearing.",
    );
  }
}
