/**
 * CHUNK 10 verification item 1 — every metric computed in exactly one place.
 *
 *   node scripts/lint-metric-duplication.mjs
 *   node scripts/lint-metric-duplication.mjs --self-test
 *   node scripts/lint-metric-duplication.mjs --list
 *
 * THE CENSUS THIS ENFORCES: 53 sites computed a percentage over the same metric
 * families — 35 client files and 18 database functions. That is the whole
 * premise of the chunk, and a count in a commit message is not a gate.
 *
 * WHAT COUNTS AS COMPUTING A METRIC: a percentage built in code — `x / y * 100`
 * or `100 * x / y` — where the surrounding line mentions the metric vocabulary.
 * Formatting an already-computed percentage (`${pct}%`, `toFixed(1)`) is not
 * computing one, and neither is a progress-bar width.
 *
 * THIS GATE FAILS ON GROWTH, NOT ON THE BACKLOG. Converging 35 files is the work
 * of the chunk, not of one commit, and a gate that is red for weeks gets ignored
 * — which is the failure mode the narrowing rule names. So the known sites are
 * listed in BASELINE with their count, the gate reports the backlog on every run
 * so it cannot quietly become permanent, and it FAILS when a site appears that
 * is not on the list. Removing a site and forgetting to update BASELINE also
 * fails, so the list cannot rot in the other direction either.
 *
 * PROVE THE GATE HAS INPUTS (G8): --self-test plants a violation in a synthetic
 * file and confirms it is reported, then plants a non-violation and confirms it
 * is not. A gate with no inputs and a gate with no findings look identical.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const LIST = argv.includes("--list");

/** The metric layer is where metrics are computed. Everything else is a finding. */
const METRIC_LAYER = "src/academic/metrics/";

const ROOTS = ["src"];

/**
 * The metric must be NAMED, not just measured in percent.
 *
 * The first version included "pct", "percent", "rate" and "ratio". Those name
 * the UNIT, not the metric, and they matched every progress indicator in the
 * app — `const pct = ((idx + 1) / items.length) * 100` in three session screens
 * is a progress bar, not a school metric. A gate that reports those trains
 * people to ignore it.
 *
 * Narrowed to words that name a THING BEING MEASURED. Validated in both
 * directions by the self-test: attendancePct still fires, a bare pct does not.
 */
const METRIC_WORDS = [
  "attendance", "present", "absent",
  "homework", "completion", "submitted", "assigned",
  "marks", "exam", "test", "score",
  "accuracy", "mastery", "pass",
];

/**
 * Known remaining computation sites, from the Chunk 10 survey. Each is a place
 * a metric is still computed outside the metric layer. Batch 2 and beyond
 * converge these; until then the list keeps them visible and stops new ones.
 */
const BASELINE = [
  "src/academic/repository/marksRepository.ts",
  "src/gurukul-parent/ParentLiveAcademic.tsx",
  "src/gurukul/pages/Analysis.tsx",
  "src/gurukul/pages/MistakeBook.tsx",
  "src/gurukul/pages/Tests.tsx",
  "src/pages/principal/PrincipalClassDetail.tsx",
  "src/pages/principal/PrincipalTeacherDetail.tsx",
  "src/pages/shared/StudentExamsResultsPage.tsx",
  "src/pages/student/Battleground.tsx",
  "src/pages/student/RecoverySessionResult.tsx",
  "src/pages/student/TestResult.tsx",
]; // 11 site(s)

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "dist" || e === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

const stripNoise = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");

/** A percentage BUILT in code, on a line that names a metric. */
export function findMetricComputations(src) {
  const out = [];
  for (const raw of stripNoise(src).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // x / y * 100   or   100 * x / y   — a division and a hundred, together.
    const builds = /\/[^\n;]*\*\s*100\b/.test(line) || /\b100\s*\*[^\n;]*\//.test(line);
    if (!builds) continue;
    if (!METRIC_WORDS.some((w) => line.toLowerCase().includes(w))) continue;
    out.push(line.slice(0, 120));
  }
  return out;
}

if (SELF_TEST) {
  const cases = [
    {
      name: "a percentage computed outside the metric layer",
      src: "const attendancePct = (present / total) * 100;",
      mustFind: true,
    },
    {
      name: "the same, written the other way round",
      src: "const rate = 100 * submitted / assigned;",
      mustFind: true,
    },
    {
      name: "NOT computing: formatting one that already exists",
      src: "return `${attendancePct.toFixed(1)}%`;",
      mustFind: false,
    },
    {
      name: "NOT computing: a progress bar width",
      src: "style={{ width: `${value}%` }}",
      mustFind: false,
    },
    {
      name: "NOT computing: a division with no metric word on the line",
      src: "const share = (a / b) * 100;",
      mustFind: false,
    },
    {
      name: "NOT computing: a metric word with no division",
      src: "const attendanceLabel = 100;",
      mustFind: false,
    },
    {
      name: "NOT computing: a progress indicator that happens to be called pct",
      src: "const pct = ((idx + (revealed ? 1 : 0)) / items.length) * 100;",
      mustFind: false,
    },
    {
      name: "STILL computing after the narrowing: a named metric",
      src: "const attendancePct = (present / total) * 100;",
      mustFind: true,
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const found = findMetricComputations(c.src).length > 0;
    const okCase = found === c.mustFind;
    if (!okCase) bad += 1;
    console.log(`  ${okCase ? "ok   " : "FAIL "} ${c.name}`);
  }
  // And the gate must have INPUTS: prove it sees real files.
  const files = ROOTS.flatMap((d) => walk(d));
  if (files.length === 0) {
    console.log("  FAIL  the gate found no source files at all — it has no inputs");
    bad += 1;
  } else {
    console.log(`  ok    the gate has inputs: ${files.length} source file(s) in scope`);
  }
  console.log(
    bad === 0
      ? `\nall ${cases.length + 1} self-test case(s) behaved. The gate detects a computed percentage,\nignores a formatted one, and is reading real files.`
      : `\n${bad} self-test case(s) FAILED. Do not trust this gate's output.`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
} else {
  const files = ROOTS.flatMap((d) => walk(d)).filter((f) => !f.startsWith(METRIC_LAYER));
  if (files.length === 0) {
    console.error("no source files found — refusing to report that as clean");
    process.exit(1);
  }

  const hits = new Map();
  for (const f of files) {
    const found = findMetricComputations(readFileSync(f, "utf8"));
    if (found.length) hits.set(f, found);
  }

  const baseline = new Set(BASELINE);
  const current = [...hits.keys()].sort();

  // --baseline prints the list in source form, so BASELINE is DERIVED from this
  // detector rather than transcribed from a different one. The first version was
  // transcribed from an earlier grep with looser criteria and disagreed with the
  // gate on 16 of 36 entries — a baseline that does not come from the thing it
  // baselines is just another number to keep in sync.
  if (argv.includes("--baseline")) {
    console.log("const BASELINE = [");
    for (const f of current) console.log(`  ${JSON.stringify(f)},`);
    console.log(`]; // ${current.length} site(s)`);
    process.exit(0);
  }
  const added = current.filter((f) => !baseline.has(f));
  const removed = [...baseline].filter((f) => !hits.has(f)).sort();

  console.log(
    `${files.length} file(s) scanned outside ${METRIC_LAYER}.\n` +
      `  ${String(current.length).padStart(3)}  file(s) still computing a metric — the backlog this chunk converges\n` +
      `  ${String(BASELINE.length).padStart(3)}  on the known list`,
  );

  if (LIST) {
    console.log("\nbacklog:");
    for (const f of current) console.log(`  ${f}\n      ${hits.get(f)[0]}`);
  }

  const problems = [];
  if (added.length) {
    problems.push(
      `${added.length} NEW site(s) computing a metric outside the metric layer:\n` +
        added.map((f) => `    ${f}\n      ${hits.get(f)[0]}`).join("\n"),
    );
  }
  if (removed.length) {
    problems.push(
      `${removed.length} site(s) on the list no longer compute anything. Converged?\n` +
        `  Remove them from BASELINE so the list cannot rot:\n` +
        removed.map((f) => `    ${f}`).join("\n"),
    );
  }

  if (problems.length === 0) {
    console.log(
      `\nno new duplication. The backlog is unchanged, and it is a BACKLOG — this gate\n` +
        `stops it growing, it does not say the chunk is done.`,
    );
  } else {
    console.log(`\n${problems.join("\n\n")}`);
    process.exitCode = 1;
  }
}
