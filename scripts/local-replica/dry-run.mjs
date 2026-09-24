// node dry-run.mjs <file.sql> [...]  (cwd = repo)  — sends the given migrations to live as ONE transaction ending in a
// deliberate RAISE, so every proof block runs against live data and nothing is committed. Success is exactly our
// marker coming back; any other error names what did not hold.
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);
if (!files.length) throw new Error("name the migration files");
const MARKER = "DRY RUN COMPLETE - deliberately rolled back";
const sql = files.map((f) => `-- ── ${path.basename(f)}\n` + readFileSync(f, "utf8").replace(/\r\n/g, "\n")).join("\n\n")
  + `\n\nDO $dryrun$ BEGIN RAISE EXCEPTION '${MARKER}'; END $dryrun$;\n`;
const out = path.join(here, "dry-run-combined.sql");
writeFileSync(out, sql);
const r = spawnSync("node", ["scripts/apply-one-migration.mjs", out, "--no-ledger"], { encoding: "utf8" });
const text = `${r.stdout}${r.stderr}`;
if (text.includes(MARKER)) console.log(`DRY RUN PASSED: ${files.length} migration(s) ran every statement and proof against live, then rolled back`);
else if (text.includes("APPLIED OK")) console.log("DANGER: the combined file COMMITTED — the marker did not fire");
else console.log(`DRY RUN FAILED:\n${text.split("\n").filter((l) => /message|ERROR|FAILED/.test(l)).join("\n").slice(0, 2000)}`);
