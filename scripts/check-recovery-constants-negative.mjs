/**
 * The negative control for scripts/check-recovery-constants.mjs.
 *
 *   node scripts/check-recovery-constants-negative.mjs [--offline]
 *
 * WHY THIS EXISTS
 * A gate that has never been seen to fail is a claim, not a check. This one
 * earned the point the hard way: it shipped green, and running these cases by
 * hand found two shapes it could not detect at all.
 *
 *   RECOVERY_SESSION_SIZE = 99
 *     It was declared TS-only ON THE GROUNDS that it was derived, but the
 *     derivation check only ran when the value failed to parse as a number.
 *     Written as a literal it parsed fine, so the derivation check was skipped
 *     AND the TS-only declaration skipped the comparison. A ten-question
 *     session declaring itself ninety-nine questions long, exit 0.
 *
 *   VARIANT_CACHE_FIRST deleted
 *     A declaration is a place the gate stops looking. With the constant gone
 *     the gate stayed green and its pass line still read "2 declared TS-only
 *     (…, VARIANT_CACHE_FIRST)" — reporting a name that was no longer there.
 *
 * Both are now caught, and both cases are below so they stay caught.
 *
 * Each case is a deliberately broken COPY of the real module, fed in through
 * RECOVERY_CONSTANTS_MODULE. Nothing here writes to the repo or the database:
 * a negative control that mutates the live table to prove a point is a worse
 * idea than the bug it is chasing.
 *
 * Cases marked offline:true need no credentials and run anywhere, including
 * CI. The rest compare against recovery_constants and are skipped, loudly and
 * by name, when there is no token.
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Overridable so this control can be pointed at an OLDER copy of the gate and
 * shown reporting NOT DETECTED. A negative control that has only ever printed
 * "detected" is the same unfalsifiable claim as the gate it is checking.
 */
const GATE = process.env.RECOVERY_CONSTANTS_GATE || "scripts/check-recovery-constants.mjs";
const SRC = "src/academic/recovery/constants.ts";
const FORCE_OFFLINE = process.argv.includes("--offline");

if (!existsSync(SRC)) {
  console.error(`missing ${SRC}`);
  process.exit(2);
}
const src = readFileSync(SRC, "utf8");
const dir = mkdtempSync(join(tmpdir(), "recovery-negctl-"));

/**
 * Every mutation asserts it changed something. A negative control whose
 * sed-equivalent quietly matched nothing would feed the gate an UNBROKEN
 * module, watch it pass, and record that as "the gate failed to detect the
 * bug" — the control lying in the opposite direction. This is the same
 * fail-open substitution shape the migrations kept hitting (G15).
 */
function mutate(text, from, to, label) {
  if (!text.includes(from)) {
    console.error(`negative control is broken: "${label}" found nothing to change in ${SRC}.`);
    console.error(`  looked for: ${JSON.stringify(from.slice(0, 90))}`);
    process.exit(2);
  }
  return text.replace(from, to);
}

const SESSION_SIZE_EXPR =
  "export const RECOVERY_SESSION_SIZE =" +
  "\n  RECOVERY_TIER0 + RECOVERY_TIER1 + RECOVERY_TIER2 + RECOVERY_TIER3;";

const CASES = [
  {
    name: "value mismatch — module 8, table 5",
    why: "the exact split-brain this gate exists for: recovery fires at one threshold, the UI describes another",
    offline: false,
    build: () => mutate(src, "RECOVERY_TRIGGER_COUNT = 5;", "RECOVERY_TRIGGER_COUNT = 8;", "trigger count"),
  },
  {
    name: "key in the module, not in the table",
    why: "a database function reading it would raise at run time",
    offline: false,
    build: () => src + "\nexport const RECOVERY_NEW_KNOB = 42;\n",
  },
  {
    name: "key in the table, not in the module",
    why: "a component needing it would have to write the literal, which §10 forbids",
    offline: false,
    build: () =>
      mutate(src, "export const REVISION_STAGES_TO_SOLID", "const REVISION_STAGES_TO_SOLID_UNEXPORTED", "stages export"),
  },
  {
    name: "array maps to 3 table rows but has 2 entries",
    why: "the declared expansion has to stay total or one interval silently loses its home",
    offline: true,
    build: () => mutate(src, "[7, 21, 60]", "[7, 21]", "revision intervals"),
  },
  {
    name: "derived RECOVERY_SESSION_SIZE replaced by a literal",
    why: "THE HOLE THIS FILE WAS WRITTEN FOR: right until someone tunes a tier, and §10 says tuning is expected",
    offline: true,
    build: () => mutate(src, SESSION_SIZE_EXPR, "export const RECOVERY_SESSION_SIZE = 99;", "session size derivation"),
  },
  {
    name: "declared TS-only constant deleted from the module",
    why: "THE SECOND HOLE: the gate stayed green and its pass line still named the missing constant",
    offline: true,
    build: () => mutate(src, "export const VARIANT_CACHE_FIRST", "const VARIANT_CACHE_FIRST_UNEXPORTED", "cache-first export"),
  },
  {
    name: "empty module",
    why: "nothing to compare must be a failure, not a vacuous pass",
    offline: true,
    build: () => "// every constant removed\n",
  },
  {
    name: "an export the parser cannot see",
    why: "a reformat must not let the gate pass by matching nothing (G11 applies to the tooling too)",
    offline: false,
    build: () => mutate(src, "\nexport const REVISION_COUNT = 8;", "\n  export const REVISION_COUNT = 8;", "revision count indent"),
  },
];

// A token in .env.local counts: the gate loads it itself.
const hasToken =
  !!process.env.SUPABASE_ACCESS_TOKEN ||
  (existsSync(".env.local") && /^\s*SUPABASE_ACCESS_TOKEN\s*=\s*\S/m.test(readFileSync(".env.local", "utf8")));
const online = hasToken && !FORCE_OFFLINE;

let failures = 0;
let ran = 0;
const skipped = [];

for (const [i, c] of CASES.entries()) {
  if (!c.offline && !online) {
    skipped.push(c.name);
    continue;
  }
  const file = join(dir, `case${i}.ts`);
  writeFileSync(file, c.build());
  const args = [GATE];
  if (!online) args.push("--offline");

  let code = 0;
  let output = "";
  try {
    output = execFileSync(process.execPath, args, {
      env: { ...process.env, RECOVERY_CONSTANTS_MODULE: file },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    code = e.status ?? 1;
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  ran++;

  if (code === 0) {
    failures++;
    console.log(`  NOT DETECTED  ${c.name}`);
    console.log(`                ${c.why}`);
    console.log(`                the gate exited 0 on a module that is wrong.`);
  } else {
    const first = output.split("\n").map((l) => l.trim()).filter(Boolean).find((l) => l.startsWith("-") || !l.startsWith("recovery constants DISAGREE"));
    console.log(`  detected      ${c.name}`);
    console.log(`                ${(first ?? "").replace(/^-\s*/, "").slice(0, 150)}`);
  }
}

for (const name of skipped) {
  console.log(`  SKIPPED       ${name} (needs SUPABASE_ACCESS_TOKEN)`);
}

console.log("");
if (failures) {
  console.error(
    `${failures} of ${ran} negative control(s) were NOT detected. ` +
      `The gate reports success on input it is supposed to reject, so its green result means nothing.`,
  );
  process.exit(1);
}
console.log(
  `all ${ran} negative control(s) detected` +
    (skipped.length ? `; ${skipped.length} skipped for want of a token (NOT passes)` : "") +
    `. The gate can fail, so its passes mean something.`,
);
