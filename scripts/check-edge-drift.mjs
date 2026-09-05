/**
 * Deploy-time hash gate for edge functions (ruling 5c).
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-05, 1 of 17 deployed edge functions had a known relationship to
 * its repo source. Two — `ai-expand-questions` and `mcp` — existed on no
 * branch at all: the only copy was the running deployment. Fourteen files
 * differed between repo and production, in BOTH directions, and the date
 * heuristic used to guess at it was wrong both ways: it flagged three functions
 * that matched exactly and cleared three of the largest diffs.
 *
 * Only a content hash settles it. That is this script.
 *
 * WHY IT DOWNLOADS RATHER THAN READING THE BODY ENDPOINT
 *
 * `GET /v1/projects/{ref}/functions/{slug}/body` returns the TRANSPILED bundle,
 * not the source files, so hashing it cannot be compared against anything in
 * the repo. `supabase functions download` returns the source as deployed, which
 * can. That costs a CLI invocation per function and is the only honest route.
 *
 * WHY THERE IS A BASELINE
 *
 * Fourteen files are known to differ and are FROZEN by ruling: the AI functions
 * are out of v1 scope and their drift is deliberately unreconciled. A gate that
 * is red on day one is a gate nobody runs. So accepted drift lives in
 * `edge-drift-baseline.json` and only NEW drift fails — the same ratchet as
 * `lint-baseline.json`, including its two-sided behaviour: when drift is
 * RESOLVED the gate also fails, so the baseline gets lowered deliberately
 * rather than silently protecting a hole that no longer exists.
 *
 * WHAT IT CANNOT DO
 *
 * It needs the network, the Supabase CLI and a token, so it is not hermetic and
 * does not belong in a sandboxed CI step without secrets. It compares source
 * text, not behaviour: two files that differ only in a comment are reported as
 * drift, which is correct for a provenance gate and would be wrong for a diff
 * review.
 *
 * A `_shared` module is only compared if some deployed function imports it —
 * the download brings down the import graph, not the whole directory. A shared
 * module that nothing deployed imports is invisible here, and correctly so:
 * there is no deployed counterpart to compare it against.
 *
 * Usage:
 *   node scripts/check-edge-drift.mjs                 verify against baseline
 *   node scripts/check-edge-drift.mjs --update        record current as accepted
 *   node scripts/check-edge-drift.mjs --only <slug>   one function
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");
const BASELINE = join(ROOT, "edge-drift-baseline.json");

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

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const update = process.argv.includes("--update");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

if (!TOKEN) {
  // Not a pass. Nothing was compared, so nothing is known.
  console.error(
    "\nBLOCKED: no SUPABASE_ACCESS_TOKEN in .env.local.\n\n" +
      "  This is NOT a pass. No function was compared against production, so\n" +
      "  the provenance of every one of them is unknown.\n",
  );
  process.exit(2);
}

/** sha256 of the content with newlines normalised, so CRLF is not drift. */
function hash(path) {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (/\.(ts|js|tsx|json)$/.test(name)) out.push(relative(base, p).replace(/\\/g, "/"));
  }
  return out;
}

async function deployedSlugs() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`function list: ${res.status} ${await res.text()}`);
  return (await res.json()).map((f) => f.slug).sort();
}

const slugs = (await deployedSlugs()).filter((s) => !only || s === only);
const tmp = mkdtempSync(join(tmpdir(), "edge-drift-"));
const findings = [];

try {
  for (const slug of slugs) {
    // The CLI writes into supabase/functions/<slug> relative to its cwd, so it
    // runs against a scratch tree and never touches the working copy.
    // `shell: true` because on Windows npx is a .cmd shim that spawnSync will
    // not execute directly — without it every download fails silently with no
    // stdout and no stderr, which the first run of this gate reported as
    // COULD-NOT-DOWNLOAD for a function that downloads fine.
    const r = spawnSync(
      "npx --yes supabase@latest functions download " + slug + " --project-ref " + PROJECT_REF,
      { cwd: tmp, encoding: "utf8", env: process.env, shell: true },
    );
    const prodDir = join(tmp, "supabase", "functions", slug);
    if (!existsSync(prodDir)) {
      findings.push({ slug, file: "-", state: "COULD-NOT-DOWNLOAD", detail: (r.stderr || r.stdout || "").trim().slice(0, 160) });
      continue;
    }
    const repoDir = join(FUNCTIONS, slug);
    if (!existsSync(repoDir)) {
      findings.push({ slug, file: "-", state: "NO-REPO-SOURCE", detail: "deployed, and on no branch" });
      continue;
    }
    const files = new Set([...walk(prodDir), ...walk(repoDir)]);
    for (const f of [...files].sort()) {
      const a = join(repoDir, f), b = join(prodDir, f);
      if (!existsSync(a)) findings.push({ slug, file: f, state: "PROD-ONLY", detail: hash(b) });
      else if (!existsSync(b)) findings.push({ slug, file: f, state: "REPO-ONLY", detail: hash(a) });
      else {
        const ha = hash(a), hb = hash(b);
        if (ha !== hb) findings.push({ slug, file: f, state: "DRIFT", detail: `repo ${ha} / prod ${hb}` });
      }
    }
  }

  // `_shared` IS THE POINT, AND THE FIRST VERSION OF THIS GATE MISSED IT.
  //
  // The download writes a function's `../_shared/*.ts` imports alongside it,
  // preserving the relative path — but the loop above walks only
  // `supabase/functions/<slug>/`, so every shared module was skipped. That is
  // why the first full run reported 6 findings where a manual diff had found
  // 14: ten of the differences were in `_shared`, including
  // `structuredCompletion.ts`, which ten functions bundle.
  //
  // A provenance gate with a silent hole is worse than no gate, so the shared
  // tree is compared once, after every download has contributed to it.
  const prodShared = join(tmp, "supabase", "functions", "_shared");
  const repoShared = join(FUNCTIONS, "_shared");
  if (existsSync(prodShared)) {
    for (const f of [...new Set(walk(prodShared))].sort()) {
      const a = join(repoShared, f), b = join(prodShared, f);
      if (!existsSync(a)) findings.push({ slug: "_shared", file: f, state: "PROD-ONLY", detail: hash(b) });
      else {
        const ha = hash(a), hb = hash(b);
        if (ha !== hb) findings.push({ slug: "_shared", file: f, state: "DRIFT", detail: `repo ${ha} / prod ${hb}` });
      }
    }
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* scratch dir */ }
}

const key = (f) => `${f.slug}:${f.file}:${f.state}`;
const now = findings.map(key).sort();

if (update) {
  writeFileSync(BASELINE, JSON.stringify({ accepted: now }, null, 2) + "\n");
  console.log(`baseline recorded: ${now.length} accepted finding(s) across ${slugs.length} function(s).`);
  console.log("  Commit edge-drift-baseline.json.");
  process.exit(0);
}

const accepted = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).accepted ?? [] : [];
const acceptedSet = new Set(accepted);
const nowSet = new Set(now);
const added = now.filter((k) => !acceptedSet.has(k));
const resolved = accepted.filter((k) => !nowSet.has(k));

console.log(`Compared ${slugs.length} deployed function(s) against repo source.\n`);
for (const f of findings) {
  const mark = acceptedSet.has(key(f)) ? "    " : "NEW ";
  console.log(`  ${mark}${f.state.padEnd(19)} ${f.slug}/${f.file}  ${f.detail}`);
}
console.log("");

if (added.length === 0 && resolved.length === 0) {
  console.log(`PASS: ${findings.length} finding(s), all accepted in the baseline.`);
  console.log("  Bounded: this proves source TEXT matches where the baseline says it should.");
  console.log("  It says nothing about behaviour, and a comment-only difference reads as drift.");
  process.exit(0);
}
if (added.length) {
  console.error(`FAIL: ${added.length} NEW finding(s) not in the baseline:`);
  for (const k of added) console.error(`  - ${k}`);
  console.error("\n  A function drifted from its repo source, or was deployed from somewhere else.");
  console.error("  Reconcile it, or accept it deliberately with --update.");
}
if (resolved.length) {
  console.error(`\nFAIL: ${resolved.length} baseline finding(s) no longer occur:`);
  for (const k of resolved) console.error(`  - ${k}`);
  console.error("\n  Drift was RESOLVED and the baseline is now stale. Lower it so the");
  console.error("  ratchet keeps meaning something:  node scripts/check-edge-drift.mjs --update");
}
process.exit(1);
