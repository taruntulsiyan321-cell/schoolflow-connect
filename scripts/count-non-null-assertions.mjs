/**
 * CHUNK 10.7 verify item 2 — zero NEW `!` non-null assertions.
 *
 *   node scripts/count-non-null-assertions.mjs
 *   node scripts/count-non-null-assertions.mjs --self-test
 *   node scripts/count-non-null-assertions.mjs --list
 *
 * WHY COUNT RATHER THAN FORBID: turning on strictNullChecks produces hundreds of
 * errors, and every one of them can be silenced with a single character. `!`
 * tells the compiler the value is not null; it does not make the value not null.
 * The defect survives and the gate goes green — the rename-versus-delete
 * distinction, one level down.
 *
 * So the number is recorded before the chunk and compared after. A fix that
 * narrows costs nothing here; a fix that asserts shows up immediately.
 *
 * WHAT A NON-NULL ASSERTION LOOKS LIKE, and what it does not:
 *
 *     foo!.bar          assertion — postfix, after an identifier
 *     arr[0]!.x         assertion — postfix, after ]
 *     fn()!.x           assertion — postfix, after )
 *     !foo              LOGICAL NOT — prefix
 *     a !== b           comparison
 *     a != b            comparison
 *     <Foo bar={!x} />  logical not
 *
 * The distinction is entirely positional: a non-null assertion is POSTFIX, so it
 * is preceded by an identifier character, `)` or `]`, and followed by something
 * that continues an expression. A regex that matches `!` alone would count every
 * boolean negation in the codebase and report a number nobody could act on.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const LIST = argv.includes("--list");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "dist" || e === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/** Comments and string bodies removed so a `!` inside text is not counted. */
const stripNoise = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");

/**
 * Postfix `!` not followed by `=`.
 *
 * The lookbehind requires an identifier char, `)` or `]` immediately before —
 * that is what makes it postfix. The negative lookahead for `=` excludes `!=`
 * and `!==`, which are comparisons however they are spaced.
 */
const ASSERTION = /(?<=[A-Za-z0-9_$)\]])!(?!=)/g;

export function countAssertions(src) {
  const body = stripNoise(src);
  return [...body.matchAll(ASSERTION)].length;
}

if (SELF_TEST) {
  const cases = [
    ["foo!.bar", 1, "after an identifier"],
    ["arr[0]!.x", 1, "after a closing bracket"],
    ["fn()!.x", 1, "after a closing paren"],
    ["const a = b!;", 1, "before a semicolon"],
    ["foo!.bar!.baz", 2, "two in one chain"],
    ["!foo", 0, "prefix logical not"],
    ["if (!ready) return;", 0, "logical not in a guard"],
    ["a !== b", 0, "strict inequality"],
    ["a != b", 0, "loose inequality"],
    ["const x = !!y;", 0, "double negation"],
    ['const s = "no!";', 0, "inside a string"],
    ["// careful!\nconst a = 1;", 0, "inside a comment"],
    ["<Foo bar={!x} />", 0, "logical not in JSX"],
  ];
  let bad = 0;
  for (const [src, want, name] of cases) {
    const got = countAssertions(src);
    const okCase = got === want;
    if (!okCase) bad += 1;
    console.log(`  ${okCase ? "ok   " : "FAIL "} ${name}  (want ${want}, got ${got})`);
  }
  const files = walk("src");
  if (files.length === 0) {
    console.log("  FAIL  no source files — the gate has no inputs");
    bad += 1;
  } else {
    console.log(`  ok    the gate has inputs: ${files.length} source file(s)`);
  }
  console.log(
    bad === 0
      ? `\nall ${cases.length + 1} self-test case(s) behaved. Postfix assertions counted,\nlogical not and inequality ignored.`
      : `\n${bad} self-test case(s) FAILED. The count cannot be trusted.`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
} else {
  const files = walk("src");
  if (files.length === 0) {
    console.error("no source files found — refusing to report a count of zero");
    process.exit(1);
  }
  let total = 0;
  const byFile = [];
  for (const f of files) {
    const n = countAssertions(readFileSync(f, "utf8"));
    if (n) {
      total += n;
      byFile.push([f, n]);
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  console.log(`${files.length} file(s) scanned.`);
  console.log(`${total} non-null assertion(s) in ${byFile.length} file(s).`);
  if (LIST) for (const [f, n] of byFile) console.log(`  ${String(n).padStart(4)}  ${f}`);
  else if (byFile.length) {
    console.log("\ntop files:");
    for (const [f, n] of byFile.slice(0, 10)) console.log(`  ${String(n).padStart(4)}  ${f}`);
    console.log("  --list for all");
  }
}
