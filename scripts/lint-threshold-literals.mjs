/**
 * CHUNK 10 verification item 2 — no component declares its own threshold.
 *
 *   node scripts/lint-threshold-literals.mjs
 *   node scripts/lint-threshold-literals.mjs --self-test
 *
 * WHY THIS IS NOT A GREP, AND WHY THE GREP WAS WITHDRAWN
 *
 * The item originally read: grep component code for 80, 60, 40, 7 and 25 and
 * show zero results. That can never be zero. Those digits occur in
 * `content.slice(0, 80)`, `if (s < 60) return "just now"`,
 * `hsl(0, 84%, 60%)` and every Tailwind class in the repository. A gate that
 * cannot go green gets weakened or switched off within a week, taking its real
 * findings with it — which is the failure the narrowing rule names.
 *
 * So it asks the question that actually matters: is a numeric literal being
 * COMPARED AGAINST, or ASSIGNED TO, something whose name says it is a metric?
 *
 *     cls.avgHomeworkCompletionPct < 60        finding — a threshold, inline
 *     const HOMEWORK_THRESHOLD = 60            finding — a threshold, redeclared
 *     content.slice(0, 80)                     not a comparison
 *     if (s < 60) return "just now"            `s` is not metric vocabulary
 *     hsl(0, 84%, 60%)                         not a comparison
 *
 * THE VOCABULARY IS THE WHOLE GATE, so it is narrow and explicit rather than
 * clever. A name matches if it contains one of the metric words below. That
 * will miss a threshold compared against a badly named variable, and the run
 * reports how many comparisons it examined and rejected so "clean" is a bounded
 * statement rather than an absolute one — the same standard as the stale-column
 * gate.
 *
 * SELF-TEST FIXTURES ARE THE FOUR REAL VIOLATIONS found in the survey:
 *   NeedsAttentionBlock.tsx:22   const HOMEWORK_THRESHOLD = 60
 *   HomeworkDrillDown.tsx:36     const HOMEWORK_THRESHOLD = 60
 *   ClassWatchlist.tsx:56        cls.avgHomeworkCompletionPct < 60
 *   thresholds.ts                marks.pass = 40, hardcoding a per-exam value
 * A gate whose negative control is invented tests the gate against itself. These
 * are the bugs it exists for.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");

/** Directories that render. The metric layer is allowed to hold thresholds. */
const COMPONENT_ROOTS = [
  "src/pages",
  "src/components",
  "src/gurukul",
  "src/gurukul-admin",
  "src/gurukul-principal",
  "src/gurukul-teacher",
  "src/hooks",
];

/** The one place a threshold may be declared. */
const ALLOWED = ["src/academic/metrics/thresholds.ts"];

/**
 * Metric vocabulary. A literal compared against an identifier containing one of
 * these is a threshold. Deliberately narrow.
 */
const METRIC_WORDS = [
  "attendance", "present", "absent",
  "homework", "completion", "submitted", "assigned",
  "marks", "score", "exam", "test",
  "pct", "percent", "percentage", "rate", "ratio",
  "accuracy", "mastery", "pass", "threshold",
];

/** Names that end a threshold hunt: they are the imported constant, not a literal. */
const THRESHOLD_CONST = /^[A-Z][A-Z0-9_]*$/;

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

function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    // Template literals and strings: a number inside one is not a comparison.
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

const isMetricName = (name) => {
  const n = name.toLowerCase();
  return METRIC_WORDS.some((w) => n.includes(w));
};

/**
 * Find thresholds in one source string.
 * Returns { findings, examined } — examined is every numeric comparison seen,
 * so a clean result states what it looked at.
 */
export function findThresholdLiterals(src) {
  const body = stripNoise(src);
  const findings = [];
  let examined = 0;

  // 1. A comparison: <identifier chain> <op> <number>, or the mirror image.
  const CMP = /([A-Za-z_$][\w$.?]*)\s*(<=?|>=?|===?|!==?)\s*(\d+(?:\.\d+)?)\b|(\d+(?:\.\d+)?)\s*(<=?|>=?|===?|!==?)\s*([A-Za-z_$][\w$.?]*)/g;
  for (const m of body.matchAll(CMP)) {
    const name = m[1] ?? m[6];
    const op = m[2] ?? m[5];
    const num = m[3] ?? m[4];
    if (!name) continue;
    examined += 1;
    // The last segment of a chain is the property being compared.
    const leaf = name.split(/[.?]/).filter(Boolean).pop() ?? name;
    if (THRESHOLD_CONST.test(leaf)) continue; // comparing against a CONSTANT, fine
    if (!isMetricName(name)) continue;
    // `x > 0`, `x === 0`, `length === 1` are EMPTINESS checks, not thresholds.
    // Every threshold in the module is 3 or greater (CONSECUTIVE_ABSENCE = 3 is
    // the smallest), so 0 and 1 can be excluded without losing one — and the
    // self-test carries both directions to prove the narrowing did not blind it.
    if (Number(num) <= 1) continue;
    findings.push({ kind: "comparison", text: `${name} ${op} ${num}`, name, value: num });
  }

  // 2. A declaration: const SOMETHING_THRESHOLD = 60, or pass: 40.
  const DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(\d+(?:\.\d+)?)\b/g;
  for (const m of body.matchAll(DECL)) {
    examined += 1;
    if (!isMetricName(m[1])) continue;
    findings.push({ kind: "declaration", text: `${m[1]} = ${m[2]}`, name: m[1], value: m[2] });
  }

  // 3. An object property that names a threshold: `pass: 40`, `low: 80`.
  const PROP = /\b(pass|low|high|threshold|min|max|floor|ceiling|classFlag|overdue)\s*:\s*(\d+(?:\.\d+)?)\b/gi;
  for (const m of body.matchAll(PROP)) {
    examined += 1;
    findings.push({ kind: "property", text: `${m[1]}: ${m[2]}`, name: m[1], value: m[2] });
  }

  return { findings, examined };
}

// ── Self-test: the four real violations, plus what must NOT fire ───────────
const FIXTURES = [
  {
    name: "NeedsAttentionBlock.tsx:22 — a redeclared threshold",
    src: "const HOMEWORK_THRESHOLD = 60\nexport function Block() { return null }",
    mustFind: true,
  },
  {
    name: "HomeworkDrillDown.tsx:36 — the same one, again",
    src: "const HOMEWORK_THRESHOLD = 60\n",
    mustFind: true,
  },
  {
    name: "ClassWatchlist.tsx:56 — a bare comparison",
    src: "if (cls.avgHomeworkCompletionPct < 60) { flag() }",
    mustFind: true,
  },
  {
    name: "thresholds.ts — marks.pass hardcoded, masking exams.passing_marks",
    src: "export const T = { marks: { pass: 40, classFlag: 25 } }",
    mustFind: true,
  },
  {
    name: "NOT a threshold: seconds since, in NotificationsPage",
    src: 'if (s < 60) return "just now";',
    mustFind: false,
  },
  {
    name: "NOT a threshold: a string slice",
    src: "const preview = replyTo.content.slice(0, 80);",
    mustFind: false,
  },
  {
    name: "NOT a threshold: an hsl colour",
    src: 'const c = { color: "hsl(0, 84%, 60%)" };',
    mustFind: false,
  },
  {
    name: "NOT a threshold: comparing against the imported constant",
    src: "if (attendancePct < ATTENDANCE_LOW) { flag() }",
    mustFind: false,
  },
  // The `<= 1` narrowing, checked in both directions. Without the second case a
  // narrowing that swallowed everything would still look like a pass.
  {
    name: "NOT a threshold: an emptiness check on a metric",
    src: "if (profile.attendancePct > 0) { render() }",
    mustFind: false,
  },
  {
    name: "NOT a threshold: a length check",
    src: "if (exams.length === 0) return null;",
    mustFind: false,
  },
  {
    name: "STILL a threshold after the narrowing: the smallest one in the module",
    src: "if (consecutiveAbsenceRate >= 3) { flag() }",
    mustFind: true,
  },
  {
    name: "STILL a threshold after the narrowing: attendance at 80",
    src: "if (attendancePct < 80) { flag() }",
    mustFind: true,
  },
];

if (SELF_TEST) {
  let bad = 0;
  for (const f of FIXTURES) {
    const { findings } = findThresholdLiterals(f.src);
    const found = findings.length > 0;
    const okCase = found === f.mustFind;
    if (!okCase) bad += 1;
    console.log(`  ${okCase ? "ok   " : "FAIL "} ${f.name}${found ? `  ->  ${findings[0].text}` : ""}`);
  }
  console.log(
    bad === 0
      ? `\nall ${FIXTURES.length} self-test case(s) behaved. The gate detects all four real violations\nand does not fire on seconds, slices, colours or an imported constant.`
      : `\n${bad} self-test case(s) FAILED. The gate is not trustworthy; fix it before reading its output.`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
} else {
  const files = COMPONENT_ROOTS.flatMap((d) => walk(d)).filter((f) => !ALLOWED.includes(f));
  if (files.length === 0) {
    console.error("no component files found — refusing to report that as clean");
    process.exit(1);
  }

  const all = [];
  let examined = 0;
  for (const f of files) {
    const { findings, examined: n } = findThresholdLiterals(readFileSync(f, "utf8"));
    examined += n;
    for (const fi of findings) all.push({ ...fi, file: f });
  }

  console.log(
    `${files.length} component file(s) scanned; ${examined} numeric comparison(s) and ` +
      `declaration(s) examined against the metric vocabulary (${METRIC_WORDS.length} word(s)).`,
  );
  console.log(`Thresholds may be declared in exactly one place: ${ALLOWED.join(", ")}`);

  if (all.length === 0) {
    console.log(
      `\nno threshold literal in component code. Bounded: this covers literals compared\n` +
        `against, or assigned to, a name in the metric vocabulary. A threshold held in a\n` +
        `variable named outside it would not be seen.`,
    );
  } else {
    console.log(`\n${all.length} THRESHOLD LITERAL(S) IN COMPONENT CODE:\n`);
    for (const f of all) console.log(`  ${f.file}\n    ${f.kind.padEnd(12)} ${f.text}`);
    console.log(
      `\nImport from src/academic/metrics/thresholds.ts. A threshold written here is a\n` +
        `second home for a number that already has one, and the two drift silently.`,
    );
    process.exitCode = 1;
  }
}
