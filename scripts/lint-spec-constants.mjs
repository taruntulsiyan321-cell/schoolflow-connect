#!/usr/bin/env node
/**
 * The spec's constant table must say what the module holds.
 *
 * `src/academic/recovery/constants.ts` is the one home for every recovery,
 * revision and analysis threshold — the spec says so itself ("one module,
 * tunable in one place… no component may contain any of these as a literal").
 * §10 of docs/recovery-revision-analysis-spec.md restates those numbers so the
 * rules can be read in one place, and a restatement rots: on 2026-09-23 it
 * still said the recovery trigger was 5 (it is 1, ruled 2026-09-15 off
 * production data) and the revision schedule was 7 / 21 / 60 (it is 7 / 7 / 7
 * then 30, ruled 2026-09-18). Two of the numbers a reader would act on.
 *
 * This reads both and fails on any disagreement, and on any constant the
 * module exports that the table does not mention — a new threshold that never
 * reaches the spec is the same rot arriving the other way.
 *
 *   node scripts/lint-spec-constants.mjs
 *   node scripts/lint-spec-constants.mjs --self-test
 */
import { readFileSync } from "node:fs";

const MODULE = "src/academic/recovery/constants.ts";
const SPEC = "docs/recovery-revision-analysis-spec.md";

/** Constants the module exports for its own internals, never quoted as rules. */
const NOT_IN_THE_TABLE = new Set([]);

/**
 * `0.80` and `0.8` are the same threshold, and `[7, 7, 7]` and `[7,7,7]` the
 * same schedule. The gate is about the RULE, not how it was typed.
 */
function sameValue(a, b) {
  if (a === b) return true;
  const num = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  if (num(a) !== null && num(b) !== null) return num(a) === num(b);
  const list = (v) => (/^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map((x) => Number(x.trim())) : null);
  const la = list(a);
  const lb = list(b);
  if (la && lb) return la.length === lb.length && la.every((x, i) => x === lb[i]);
  return false;
}

/** `export const NAME = <value>;` — numbers, booleans and number arrays. */
export function readModuleConstants(source) {
  const out = new Map();
  const re = /export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*([^;]+);/g;
  for (const [, name, raw] of source.matchAll(re)) {
    const value = raw.replace(/\s*as const\s*$/, "").trim();
    if (/^\[.*\]$/.test(value)) {
      const nums = value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
      if (nums.every((n) => /^-?\d+(\.\d+)?$/.test(n))) { out.set(name, `[${nums.join(",")}]`); continue; }
    }
    if (/^-?\d+(\.\d+)?$/.test(value) || value === "true" || value === "false") { out.set(name, value); continue; }
    // One constant defined as another (RECOVERY_RELEARN_ABOVE = RECOVERY_WIDE_MAX_MISTAKES)
    // is still a rule the table quotes, so it resolves to the value it takes.
    if (out.has(value)) { out.set(name, out.get(value)); continue; }
    // Anything else (an expression, a string) is not a number the table can
    // quote, and is skipped rather than guessed at.
  }
  return out;
}

/** `NAME = <value>` lines inside the spec's fenced constant block. */
export function readSpecConstants(markdown) {
  const start = markdown.indexOf("## 10. Constants");
  if (start < 0) throw new Error(`${SPEC}: no "## 10. Constants" section`);
  const fenceOpen = markdown.indexOf("```", start);
  const fenceClose = markdown.indexOf("```", fenceOpen + 3);
  if (fenceOpen < 0 || fenceClose < 0) throw new Error(`${SPEC}: §10 has no fenced constant block`);
  const block = markdown.slice(fenceOpen + 3, fenceClose);
  const out = new Map();
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*([^/]+?)\s*(\/\/.*)?$/);
    if (!m) continue;
    const value = m[2].trim();
    out.set(m[1], /^\[.*\]$/.test(value) ? `[${value.slice(1, -1).split(",").map((v) => v.trim()).join(",")}]` : value);
  }
  return out;
}

export function compare(moduleConstants, specConstants) {
  const problems = [];
  for (const [name, value] of specConstants) {
    if (!moduleConstants.has(name)) {
      problems.push(`${name}: the spec states ${value}, the module does not export it`);
    } else if (!sameValue(moduleConstants.get(name), value)) {
      problems.push(`${name}: the spec says ${value}, the module holds ${moduleConstants.get(name)}`);
    }
  }
  for (const [name] of moduleConstants) {
    if (!specConstants.has(name) && !NOT_IN_THE_TABLE.has(name)) {
      problems.push(`${name}: the module holds ${moduleConstants.get(name)}, and §10 never mentions it`);
    }
  }
  return problems;
}

function selfTest() {
  const mod = readModuleConstants(
    "export const A_NUMBER = 3;\nexport const A_LIST = [7, 7, 7] as const;\nexport const A_FLAG = true;\n",
  );
  const asSpec = (body) => `## 10. Constants\n\n\`\`\`\n${body}\n\`\`\`\n`;
  const checks = [
    ["a table that agrees passes",
      compare(mod, readSpecConstants(asSpec("A_NUMBER = 3\nA_LIST = [7, 7, 7]\nA_FLAG = true"))).length === 0],
    ["a stale number fails",
      compare(mod, readSpecConstants(asSpec("A_NUMBER = 5\nA_LIST = [7, 7, 7]\nA_FLAG = true"))).some((p) => p.startsWith("A_NUMBER"))],
    ["a stale list fails",
      compare(mod, readSpecConstants(asSpec("A_NUMBER = 3\nA_LIST = [7, 21, 60]\nA_FLAG = true"))).some((p) => p.startsWith("A_LIST"))],
    ["a constant the table never mentions fails",
      compare(mod, readSpecConstants(asSpec("A_NUMBER = 3\nA_LIST = [7, 7, 7]"))).some((p) => p.startsWith("A_FLAG"))],
    ["a constant the module does not export fails",
      compare(mod, readSpecConstants(asSpec("A_NUMBER = 3\nA_LIST = [7, 7, 7]\nA_FLAG = true\nGHOST = 9"))).some((p) => p.startsWith("GHOST"))],
    ["comments after a value are not part of it",
      readSpecConstants(asSpec("A_NUMBER = 3      // days")).get("A_NUMBER") === "3"],
    ["0.80 and 0.8 are the same threshold, and spacing in a list does not matter",
      compare(readModuleConstants("export const A_RATIO = 0.8;\nexport const A_LIST = [7,7,7] as const;\n"),
        readSpecConstants(asSpec("A_RATIO = 0.80\nA_LIST = [7, 7, 7]"))).length === 0],
    ["a constant defined as another resolves to its value, and is still checked",
      compare(readModuleConstants("export const BASE = 8;\nexport const DERIVED = BASE;\n"),
        readSpecConstants(asSpec("BASE = 8\nDERIVED = 9"))).some((p) => p.startsWith("DERIVED"))],
  ];
  let bad = 0;
  for (const [what, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
    if (!ok) bad++;
  }
  console.log(bad === 0
    ? `\nself-test: ${checks.length} checks, and each disagreement is detected — the gate can fail.`
    : `\nself-test: ${bad} of ${checks.length} FAILED`);
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--self-test")) selfTest();

const moduleConstants = readModuleConstants(readFileSync(MODULE, "utf8"));
const specConstants = readSpecConstants(readFileSync(SPEC, "utf8"));
const problems = compare(moduleConstants, specConstants);

if (problems.length === 0) {
  console.log(`spec constants: ${specConstants.size} of ${moduleConstants.size} module constants quoted in §10, all in agreement.`);
  process.exit(0);
}
console.error(`${SPEC} §10 disagrees with ${MODULE}:\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(`\nThe module is the one home. Change the number there, then say so in §10 with the ruling behind it.`);
process.exit(1);
