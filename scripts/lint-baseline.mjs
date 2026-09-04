/**
 * LINT AS A GATE, AT TODAY'S BASELINE — not as a project.
 *
 *   node scripts/lint-baseline.mjs            check against the baseline
 *   node scripts/lint-baseline.mjs --update   re-record it (deliberate act)
 *
 * ── WHY A BASELINE AND NOT A CLEAN RUN ────────────────────────────────────
 *
 * `npm run lint` reports 143 errors and 82 warnings, none of them introduced by
 * recent work. Two bad options were on the table: fix 143 findings before lint
 * can gate anything, or leave lint permanently red. The second is the one this
 * repo already learned to distrust — a gate that is always red stops being
 * read, which is exactly how `preflight` shipped a migration with no rollback
 * and `db:check-migrations` sat on two false pendings.
 *
 * So the debt is recorded with a number and frozen. The gate asks one question:
 * did this change make it worse? That is answerable today, on every commit,
 * and it is the question that actually protects the codebase. Paying the debt
 * down can be its own pass; it is not a precondition for having a gate.
 *
 * ── WHY THE COUNT AND NOT A PER-FILE SNAPSHOT ─────────────────────────────
 *
 * A per-file baseline would let a new error hide behind a fixed one in the same
 * file, and it churns on every rename. Totals cannot hide that: fix one and
 * introduce one and the number is unchanged, which is the honest reading —
 * nothing got worse. Fix one and introduce two and it fails.
 *
 * The trade is deliberate and worth stating: this gate does NOT prove a
 * specific new violation was not added, only that the totals did not grow. It
 * is a ratchet, not a proof.
 *
 * ── WHY IT FAILS WHEN THE NUMBER DROPS ────────────────────────────────────
 *
 * Fixing findings is good and the gate still fails, asking for `--update`. A
 * baseline nobody lowers is a baseline that silently stops meaning anything:
 * six months of quiet fixes and the ratchet is 40 findings above reality, with
 * room to add 40 more unnoticed. Lowering it is one command and it keeps the
 * recorded number honest.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "lint-baseline.json");
const TMP = join(ROOT, ".eslint-baseline-report.json");

const update = process.argv.includes("--update");

function runEslint() {
  // eslint exits 1 when it finds errors; that is the normal path here, so the
  // exit code is ignored and the REPORT is the source of truth. A missing or
  // unparseable report is a genuine failure and is not treated as "clean".
  //
  // eslint's JS entry point is invoked with this same node binary rather than
  // through `npx`: on Windows npx resolves to npx.cmd, which Node 24 refuses to
  // spawn without `shell: true`, and a shell would then have to quote a repo
  // path containing spaces. Calling the script directly avoids both.
  //
  // RESOLVED BY WALKING UP, not by joining ROOT. In a git worktree under
  // .claude/worktrees/, node_modules is EMPTY and Node resolves packages from
  // the primary checkout further up the tree — so a hardcoded
  // `join(ROOT, "node_modules", ...)` reports "eslint not installed" in exactly
  // the place the gate is most needed. The BLOCKED exit was correct; the path
  // was not.
  const BIN = (() => {
    let dir = ROOT;
    for (;;) {
      const candidate = join(dir, "node_modules", "eslint", "bin", "eslint.js");
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  })();
  if (!BIN) {
    console.error(
      `BLOCKED: eslint not found in any node_modules from ${ROOT} upwards. Run npm install.`,
    );
    process.exit(2);
  }
  try {
    execFileSync(process.execPath, [BIN, ".", "-f", "json", "-o", TMP], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    /* exit 1 = findings exist; the report below decides */
  }

  if (!existsSync(TMP)) {
    console.error("BLOCKED: eslint produced no report. The check did not run.");
    console.error("  This is not a pass. Fix the eslint invocation and re-run.");
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(TMP, "utf8"));
  } catch (e) {
    console.error(`BLOCKED: eslint report is not valid JSON — ${e.message}`);
    process.exit(2);
  } finally {
    unlinkSync(TMP);
  }

  if (!Array.isArray(report) || report.length === 0) {
    console.error("BLOCKED: eslint reported on 0 files. It linted nothing.");
    console.error("  An empty run is not a clean run — check the config and globs.");
    process.exit(2);
  }

  let errors = 0;
  let warnings = 0;
  for (const f of report) {
    errors += f.errorCount ?? 0;
    warnings += f.warningCount ?? 0;
  }
  return { errors, warnings, files: report.length };
}

const now = runEslint();

if (update) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ errors: now.errors, warnings: now.warnings }, null, 2)}\n`,
  );
  console.log(`baseline recorded: ${now.errors} error(s), ${now.warnings} warning(s)`);
  console.log(`  across ${now.files} linted file(s). Commit lint-baseline.json.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("no lint-baseline.json. Record one with: node scripts/lint-baseline.mjs --update");
  process.exit(2);
}

const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const dErrors = now.errors - base.errors;
const dWarnings = now.warnings - base.warnings;

console.log(`eslint: ${now.errors} error(s), ${now.warnings} warning(s) across ${now.files} file(s)`);
console.log(`baseline: ${base.errors} error(s), ${base.warnings} warning(s)`);

if (dErrors > 0 || dWarnings > 0) {
  console.error("");
  console.error("FAIL: lint got worse.");
  if (dErrors > 0) console.error(`  +${dErrors} error(s)`);
  if (dWarnings > 0) console.error(`  +${dWarnings} warning(s)`);
  console.error("");
  console.error("  Fix what this change introduced. Do NOT raise the baseline to");
  console.error("  absorb it — the baseline is existing debt, not a budget.");
  console.error("  See the findings with: npm run lint");
  process.exit(1);
}

if (dErrors < 0 || dWarnings < 0) {
  console.error("");
  console.error("FAIL: lint got BETTER and the baseline is now stale.");
  if (dErrors < 0) console.error(`  ${dErrors} error(s)`);
  if (dWarnings < 0) console.error(`  ${dWarnings} warning(s)`);
  console.error("");
  console.error("  Lower it so the ratchet keeps meaning something:");
  console.error("    node scripts/lint-baseline.mjs --update");
  process.exit(1);
}

console.log("");
console.log("PASS: no new errors, no new warnings.");
console.log("  Bounded: this proves the TOTALS did not grow, not that no new");
console.log("  violation was added — one fixed and one added reads as unchanged.");
