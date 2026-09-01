/**
 * §10.8 — "Strong areas are never shown anywhere in the app. The product
 * surfaces weaknesses only."
 *
 *   node scripts/lint-strength-surfaces.mjs
 *   node scripts/lint-strength-surfaces.mjs --self-test
 *   node scripts/lint-strength-surfaces.mjs --reachable-only
 *
 * WHY A GATE AND NOT A GREP. Chunk 7B closed this rule in the DATABASE:
 * `_snapshot_battle_report` computed topics.strong, three policies served it,
 * and CHUNK7B_BATCH1_VERIFY could not have found it because it swept
 * information_schema for correctness COLUMNS and the data was inside a jsonb
 * blob. The client half was never swept at all.
 *
 * A band that says "Strong" is not a threshold literal that needs importing. It
 * is a product rule violation wearing a number, and converging it onto a
 * constant would have tidied the code and left the rule broken — which is why
 * this ran before the ladders were touched.
 *
 * WHAT COUNTS. A site that LABELS or SELECTS a student's strengths:
 *   - a label string: "Strong", "Mastered", "Proficient", "Excellent"
 *   - a named selection: strong_concepts, strongConcepts, strongAreas, mastered
 *   - a band whose top rung is one of those names
 *
 * WHAT DOES NOT. Weakness labels, and the word "strong" in prose that is not a
 * label. Accuracy itself is explicitly permitted: "Session totals are stored
 * (attempted, correct count) SO ACCURACY CAN BE SHOWN." A percentage is not a
 * strength area; a list of topics headed "Strong" is.
 *
 * REACHABILITY IS REPORTED, NOT FILTERED. 54 of 169 screens are reachable from
 * no route, and a §10.8 violation on one of them is not live — but it is not
 * fixed either, and a route added later makes it live without anyone re-reading
 * it. Both columns, always.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { reachableFrom } from "./lint-unreachable-screens.mjs";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const REACHABLE_ONLY = argv.includes("--reachable-only");

const ROUTERS = [
  "src/App.tsx",
  "src/gurukul-principal/PrincipalApp.tsx",
  "src/gurukul-admin/AdminApp.tsx",
  "src/gurukul-teacher/TeacherApp.tsx",
  "src/gurukul-parent/ParentApp.tsx",
  "src/gurukul/GurukulApp.tsx",
];

/** A label a student would read as "you are good at this". */
const STRENGTH_LABEL = /["'`](Strong|Mastered|Proficient|Excellent|Strength|Strong areas?)["'`]/;

/** A named selection of strengths. */
const STRENGTH_SELECTION =
  /\b(strong_concepts|strongConcepts|strong_areas|strongAreas|strong_topics|strongTopics|masteredConcepts|mastered_concepts)\b/;

/** A band whose rung is a strength name, e.g. `return "mastered"`. */
const STRENGTH_BAND = /\breturn\s+["'`](mastered|strong|proficient)["'`]/i;

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

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

export function findStrengthSurfaces(src) {
  const out = [];
  const lines = stripComments(src).split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let kind = null;
    if (STRENGTH_SELECTION.test(line)) kind = "selection";
    else if (STRENGTH_BAND.test(line)) kind = "band";
    else if (STRENGTH_LABEL.test(line)) kind = "label";
    if (kind) out.push({ line: i + 1, kind, text: line.slice(0, 110) });
  });
  return out;
}

if (SELF_TEST) {
  const cases = [
    { name: 'a label: accuracy >= 75 ? "Strong"', src: 'const l = a >= 75 ? "Strong" : "Needs focus";', find: true },
    { name: "a named selection: strong_concepts", src: "const s = insights.strong_concepts ?? [];", find: true },
    { name: 'a band rung: return "mastered"', src: 'if (s >= 78) return "mastered";', find: true },
    { name: "NOT a violation: a weakness label", src: 'const l = a < 40 ? "Needs focus" : "";', find: false },
    { name: "NOT a violation: accuracy shown as a number (§10.8 permits it)", src: "return `${accuracy}% accuracy`;", find: false },
    { name: "NOT a violation: the word strong inside a comment", src: '// strong areas are never shown\nconst x = 1;', find: false },
    { name: "NOT a violation: a css class called border-strong", src: 'const c = "border-strong";', find: false },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = findStrengthSurfaces(c.src).length > 0;
    const okCase = got === c.find;
    if (!okCase) bad += 1;
    console.log(`  ${okCase ? "ok   " : "FAIL "} ${c.name}`);
  }
  const files = walk("src");
  if (files.length === 0) { console.log("  FAIL  no source files — the gate has no inputs"); bad += 1; }
  else console.log(`  ok    the gate has inputs: ${files.length} source file(s)`);
  console.log(
    bad === 0
      ? `\nall ${cases.length + 1} self-test case(s) behaved.`
      : `\n${bad} self-test case(s) FAILED. Do not trust this gate's output.`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
} else {
  const files = walk("src");
  if (files.length === 0) {
    console.error("no source files found — refusing to report that as clean");
    process.exit(1);
  }
  const reach = reachableFrom(ROUTERS.filter((f) => existsSync(f)));

  const hits = [];
  for (const f of files) {
    for (const h of findStrengthSurfaces(readFileSync(f, "utf8"))) {
      hits.push({ ...h, file: f, reachable: reach.has(f) });
    }
  }
  const live = hits.filter((h) => h.reachable);
  const dead = hits.filter((h) => !h.reachable);

  console.log(
    `§10.8 — "Strong areas are never shown anywhere in the app."\n` +
      `${files.length} file(s) scanned.\n` +
      `  ${String(live.length).padStart(3)}  on screens a role CAN reach\n` +
      `  ${String(dead.length).padStart(3)}  on screens no route reaches — not live, not fixed either`,
  );

  const show = (title, rows) => {
    if (rows.length === 0) return;
    console.log(`\n${title}`);
    const byFile = new Map();
    for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    for (const [file, rs] of byFile) {
      console.log(`  ${file}`);
      for (const r of rs) console.log(`    :${String(r.line).padEnd(4)} ${r.kind.padEnd(9)} ${r.text}`);
    }
  };

  show("LIVE — a student can see these:", live);
  if (!REACHABLE_ONLY) show("UNREACHABLE — fix or delete, but not live today:", dead);

  if (live.length > 0) process.exitCode = 1;
}
