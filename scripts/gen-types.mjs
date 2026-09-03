/**
 * Regenerate src/integrations/supabase/types.ts.
 *
 * WHY THIS IS NOT A ONE-LINER ANY MORE
 *
 * It used to be:
 *
 *     supabase gen types typescript --project-id … > src/integrations/supabase/types.ts
 *
 * The shell opens the redirect BEFORE the command runs, so `>` truncated
 * types.ts to zero bytes and only then asked the CLI for a schema. When the CLI
 * could not authenticate it printed a JSON error to stdout — and that JSON
 * landed in types.ts. The generated types for 136 tables were replaced by:
 *
 *     {"message":"Unauthorized"}
 *
 * and the command exited 0, so nothing downstream noticed. `tsc -b` then failed
 * with thousands of errors that all looked like application bugs.
 *
 * A type generator has exactly one dangerous property: it overwrites the file
 * the whole app is typed against. So this script never writes that file until
 * it is holding something that is demonstrably a schema.
 *
 * THE CHECKS, AND WHY EACH EXISTS
 *
 *   exit code        the CLI failed and said so
 *   JSON body        the CLI failed and said so on stdout instead
 *   marker           `export type Database` — proves it is TypeScript
 *   floor            a plausible schema is not 400 bytes
 *   shrink guard     a schema that lost >20% of its lines is a partial dump or
 *                    a wrong --project-id, not a refactor. G11: a check that
 *                    cannot fail is not a check, so this one CAN fail a
 *                    legitimate big deletion — pass --allow-shrink and say so.
 *
 * Only then: write to a sibling temp file and rename over the target, so an
 * interrupted run leaves the previous types.ts intact rather than half of one.
 *
 * Usage: node scripts/gen-types.mjs [--allow-shrink] [--dry-run]
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TARGET = join(ROOT, "src", "integrations", "supabase", "types.ts");
const TMP = `${TARGET}.new`;

const MARKER = "export type Database";
const MIN_BYTES = 20_000;
const MAX_SHRINK = 0.2;

const allowShrink = process.argv.includes("--allow-shrink");
const dryRun = process.argv.includes("--dry-run");

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";

function die(msg, detail) {
  console.error(`\ndb:types FAILED — types.ts was NOT modified.\n`);
  console.error(`  ${msg}`);
  if (detail) console.error(`\n${String(detail).trim().slice(0, 800)}`);
  console.error("");
  if (existsSync(TMP)) {
    try {
      unlinkSync(TMP);
    } catch {
      /* the temp file is not worth failing over */
    }
  }
  process.exit(1);
}

if (!process.env.SUPABASE_ACCESS_TOKEN && !process.env.SUPABASE_DB_URL) {
  die(
    "No SUPABASE_ACCESS_TOKEN (or SUPABASE_DB_URL) in the environment or .env.local.\n" +
      "  Refusing to run: without a credential the CLI returns an auth error, and\n" +
      "  the old one-liner wrote that error into types.ts.",
  );
}

console.log(`Generating types for project ${PROJECT_REF}…`);

const res = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", "supabase@latest", "gen", "types", "typescript", "--project-id", PROJECT_REF],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
);

if (res.error) die(`could not run the Supabase CLI: ${res.error.message}`);
if (res.status !== 0) die(`the Supabase CLI exited ${res.status}.`, res.stderr || res.stdout);

const out = (res.stdout || "").trim();

if (!out) die("the Supabase CLI produced no output.", res.stderr);

// The failure that started all this: an error object on stdout.
if (out.startsWith("{") || out.startsWith("[")) {
  die("the Supabase CLI returned JSON, not TypeScript — almost certainly an auth or project error.", out);
}
if (!out.includes(MARKER)) {
  die(`output does not contain \`${MARKER}\` — it is not a generated schema.`, out.slice(0, 400));
}
if (Buffer.byteLength(out, "utf8") < MIN_BYTES) {
  die(
    `output is ${Buffer.byteLength(out, "utf8")} bytes, below the ${MIN_BYTES}-byte floor — a partial dump.`,
    out.slice(0, 400),
  );
}

const newLines = out.split("\n").length;
let verdict = `${newLines} lines`;

if (existsSync(TARGET)) {
  const oldLines = readFileSync(TARGET, "utf8").split("\n").length;
  const delta = newLines - oldLines;
  verdict = `${oldLines} → ${newLines} lines (${delta >= 0 ? "+" : ""}${delta})`;
  if (oldLines > 0 && newLines < oldLines * (1 - MAX_SHRINK) && !allowShrink) {
    die(
      `the new schema is ${Math.round((1 - newLines / oldLines) * 100)}% smaller than the current one ` +
        `(${oldLines} → ${newLines} lines).\n` +
        `  That is what a wrong --project-id or a partial dump looks like.\n` +
        `  If this shrink is real, re-run with --allow-shrink.`,
    );
  }
}

if (dryRun) {
  console.log(`DRY RUN — validated ${verdict}; types.ts not written.`);
  process.exit(0);
}

writeFileSync(TMP, `${out}\n`, "utf8");
renameSync(TMP, TARGET);

console.log(`OK: src/integrations/supabase/types.ts  ${verdict}`);
