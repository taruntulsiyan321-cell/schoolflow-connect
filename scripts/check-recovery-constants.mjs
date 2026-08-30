/**
 * The recovery constants live in two homes, and this proves they agree.
 *
 *   node scripts/check-recovery-constants.mjs
 *
 * WHY TWO HOMES
 * A database function cannot import a TypeScript module, and §10 forbids these
 * numbers appearing as literals in either place. There is no third option, so
 * the design stays. What it needs is a check.
 *
 * WHY A GATE AND NOT A CONVENTION
 * Two places holding one fact is G9's shape, and "kept in sync" holds until
 * someone changes one. If RECOVERY_TRIGGER_COUNT is 5 in the table and 8 in the
 * module, nothing errors: recovery fires at one threshold, the UI describes
 * another, and the first person to notice is a confused student. Nothing in
 * either home can detect that on its own — only something that reads both.
 *
 * WHAT IT FAILS ON
 *   - any key whose values differ
 *   - any key in the module and not the table
 *   - any key in the table and not the module
 *   - any asymmetry that is not on the declared list below
 *   - RECOVERY_SESSION_SIZE not equalling the four tiers it is derived from
 *   - parsing fewer exports than expected, so a reformat of the module cannot
 *     make this pass by matching nothing (G11: this rule applies to the
 *     tooling too)
 */
import { readFileSync, existsSync } from "fs";
import { queryRows, connectionMode, describeConnection, closeConnection } from "./lib/readonly-db.mjs";

/**
 * Overridable so the negative control can point at a deliberately broken copy
 * and prove this gate reports failure, without editing the real module or
 * mutating the live table to do it.
 */
const MODULE_PATH = process.env.RECOVERY_CONSTANTS_MODULE || "src/academic/recovery/constants.ts";

/**
 * --offline runs only the half that needs no database: parse completeness,
 * declared-key presence, the derivation check, and the array arity. That is
 * where the hole actually was — RECOVERY_SESSION_SIZE written as a literal is
 * detectable with no credentials at all — so CI can run this today rather than
 * waiting on a SUPABASE_ACCESS_TOKEN secret this repo does not have.
 *
 * It is an explicit FLAG and never an automatic degradation. A missing token
 * without the flag is exit 2, not a quiet downgrade to the weak half followed
 * by exit 0 — that is the "a check that did not run is not a pass" rule, and a
 * gate is the last place to break it. An --offline run also never prints that
 * the two homes agree, because it did not look.
 */
const OFFLINE = process.argv.includes("--offline");

/**
 * Declared asymmetries. Every entry is a place the two homes are ALLOWED to
 * differ, and each needs a reason that survives being read aloud. Anything not
 * listed here must exist in both. Keep this list short: each line is a place
 * the gate stops looking.
 */
const TS_ONLY = {
  VARIANT_CACHE_FIRST:
    "boolean. recovery_constants.value is numeric, and encoding true as 1 is the type-lie that produces a `value > 0` bug later. If a database function needs it, give the table a boolean column then.",
};

/**
 * Constants with no table row because they are COMPUTED from constants that
 * have one. A separate category from TS_ONLY because the two make different
 * promises: TS_ONLY says "this value is not checked against the database",
 * DERIVED says "this value is checked against its own inputs instead".
 *
 * Collapsing them is what let RECOVERY_SESSION_SIZE go unchecked. It was
 * declared TS-only ON THE GROUNDS that it was derived — but the derivation
 * check only ran when the expression failed to parse as a number. Written as
 * `= 10` it parsed fine, so the derivation check was skipped and TS_ONLY
 * skipped the comparison: a constant with no home in the table and no check
 * anywhere. `= 99` passed this gate.
 *
 * A declaration is a place the gate stops looking. It has to say which check
 * it is trading for, and that check has to actually run.
 */
const DERIVED = {
  RECOVERY_SESSION_SIZE: {
    inputs: ["RECOVERY_TIER0", "RECOVERY_TIER1", "RECOVERY_TIER2", "RECOVERY_TIER3"],
    combine: (xs) => xs.reduce((a, b) => a + b, 0),
    how: "the sum of the four tier counts",
  },
};

/**
 * One module export that expands to several table rows. Declared rather than
 * special-cased in the comparison, so the mapping is visible and the gate can
 * check the array length against the number of rows it maps to.
 */
const EXPANSIONS = {
  REVISION_INTERVALS_DAYS: ["REVISION_INTERVAL_1", "REVISION_INTERVAL_2", "REVISION_INTERVAL_3"],
};

// ── Read the module ────────────────────────────────────────────────────────

if (!existsSync(MODULE_PATH)) {
  console.error(`missing ${MODULE_PATH}`);
  process.exit(2);
}
const src = readFileSync(MODULE_PATH, "utf8");

/** `export const NAME = <number | true | false | [1, 2, 3]>;` */
const tsValues = new Map();
/** The source text as written, so DERIVED can check the FORM and not just the value. */
const tsRaw = new Map();
for (const m of src.matchAll(
  /^export const ([A-Z][A-Z0-9_]*)\s*=\s*([^;]+?)(?:\s+as const)?;/gm,
)) {
  const [, name, raw] = m;
  const text = raw.trim();
  let value;
  if (/^\[[^\]]*\]$/.test(text)) {
    value = text
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
    if (value.some(Number.isNaN)) continue;
  } else if (text === "true" || text === "false") {
    value = text === "true";
  } else if (/^-?\d+(\.\d+)?$/.test(text)) {
    value = Number(text);
  } else {
    // A derived expression such as TIER0 + TIER1 + ... — recorded so the key
    // is not silently dropped, and resolved further down.
    value = { expr: text };
  }
  tsValues.set(name, value);
  tsRaw.set(name, text);
}

// A reformat of the module must not make this gate pass by matching nothing.
const declaredExports = (src.match(/^export const [A-Z][A-Z0-9_]*\s*=/gm) ?? []).length;
if (tsValues.size !== declaredExports) {
  console.error(
    `parsed ${tsValues.size} of ${declaredExports} exported constants from ${MODULE_PATH}. ` +
      `The parser did not understand one of them, so this gate cannot speak for it.`,
  );
  process.exit(1);
}
if (declaredExports === 0) {
  console.error(`found no exported constants in ${MODULE_PATH} — the gate would pass vacuously.`);
  process.exit(1);
}

// Every DECLARED key must actually be in the module.
//
// A declaration is a place this gate stops looking, so one naming a constant
// that is no longer there disables a check AND prints a reassuring name in the
// pass line. Deleting VARIANT_CACHE_FIRST from the module left this gate green
// and still reporting "2 declared TS-only (…, VARIANT_CACHE_FIRST)".
for (const [group, keys] of [
  ["TS_ONLY", Object.keys(TS_ONLY)],
  ["DERIVED", Object.keys(DERIVED)],
  ["EXPANSIONS", Object.keys(EXPANSIONS)],
]) {
  for (const key of keys) {
    if (tsValues.has(key)) continue;
    console.error(
      `${key} is declared in ${group} but no longer exists in ${MODULE_PATH}. ` +
        `A declaration for a constant that is gone silently disables a check.`,
    );
    process.exit(1);
  }
}

// Derived constants are checked against their inputs — UNCONDITIONALLY.
//
// The form is checked as well as the value: RECOVERY_SESSION_SIZE has to BE
// the sum in the source, not merely equal it today. A literal that happens to
// be right is correct until someone tunes a tier, and §10 says these are
// expected to be tuned.
for (const [key, rule] of Object.entries(DERIVED)) {
  const expr = tsRaw.get(key);
  const missing = rule.inputs.filter((i) => !expr.includes(i));
  if (missing.length) {
    console.error(
      `${key} must BE ${rule.how} in the source, not merely equal it.\n` +
        `  found:   ${key} = ${expr}\n` +
        `  missing: ${missing.join(", ")}\n` +
        `  Written as a literal it is right until a tier is tuned, and then nothing catches it.`,
    );
    process.exit(1);
  }
  const inputs = rule.inputs.map((i) => Number(tsValues.get(i)));
  if (inputs.some(Number.isNaN)) {
    console.error(`cannot resolve ${key}: an input constant is missing or non-numeric.`);
    process.exit(1);
  }
  tsValues.set(key, rule.combine(inputs));
}

for (const [k, v] of tsValues) {
  if (typeof v === "object" && !Array.isArray(v)) {
    console.error(`${k} is an expression this gate cannot evaluate: ${v.expr}`);
    process.exit(1);
  }
}

// ── Read the table ─────────────────────────────────────────────────────────

/**
 * Everything from the fetch onwards sets process.exitCode and lets the process
 * end, rather than calling process.exit(). Calling exit() after a fetch tears
 * down undici's in-flight handles and aborts with a libuv assertion, so the
 * shell sees 127 instead of 1 — a gate reporting a code it did not choose. 127
 * is still non-zero and CI would still fail, but a gate that cannot state its
 * own result accurately is the wrong thing to trust the rest of this with.
 */
function fail(lines) {
  for (const l of [].concat(lines)) console.error(l);
  process.exitCode = 1;
}

/** Empty and unread until the fetch succeeds; `dbRead` is what licenses a comparison. */
const dbValues = new Map();
let dbRead = false;

let connection = "not attempted";
if (!OFFLINE) {
if (connectionMode() === "none") {
  console.error(
    "No database credential, so the two homes cannot be compared.\n" +
      "  CI_READONLY_DATABASE_URL is the read-only role and the one CI should use.\n" +
      "  SUPABASE_ACCESS_TOKEN is the local convenience path.\n" +
      "  Or run with --offline to check the module half only — a narrower claim, and it says so.",
  );
  process.exit(2);
}
connection = describeConnection();

let rows;
try {
  rows = await queryRows("SELECT key, value FROM public.recovery_constants ORDER BY key");
} catch (e) {
  fail(`could not read recovery_constants via ${connection}: ${e.message.slice(0, 300)}`);
}

if (process.exitCode !== 1 && (!Array.isArray(rows) || rows.length === 0)) {
  fail(
    `recovery_constants returned no rows (${JSON.stringify(rows).slice(0, 200)}). ` +
      `An empty table would let every module constant look "absent from the database" ` +
      `rather than mismatched, so this is a failure, not a pass.`,
  );
}

if (Array.isArray(rows)) for (const r of rows) dbValues.set(r.key, Number(r.value));
// Only a read that actually produced rows licenses the comparison below.
dbRead = process.exitCode !== 1;
await closeConnection();
}

// ── Compare ────────────────────────────────────────────────────────────────

const problems = [];

// Expand the declared array mappings into the same shape as the table.
const tsFlat = new Map();
for (const [name, value] of tsValues) {
  const expansion = EXPANSIONS[name];
  if (expansion) {
    if (!Array.isArray(value)) {
      problems.push(`${name} is declared as expanding to ${expansion.length} rows but is not an array.`);
      continue;
    }
    if (value.length !== expansion.length) {
      problems.push(
        `${name} has ${value.length} entries but maps to ${expansion.length} table keys ` +
          `(${expansion.join(", ")}). Add or remove a key so the mapping stays total.`,
      );
      continue;
    }
    expansion.forEach((key, i) => tsFlat.set(key, value[i]));
    continue;
  }
  tsFlat.set(name, value);
}

// Both comparison loops are gated on dbRead. Offline they do not run, and the
// report below refuses to claim the homes agree rather than reporting the zero
// problems that not looking produces.
if (dbRead) for (const [key, tsValue] of tsFlat) {
  const declaredAbsent = TS_ONLY[key] ? "TS-only" : DERIVED[key] ? "derived" : null;
  if (declaredAbsent) {
    if (dbValues.has(key)) {
      problems.push(
        `${key} is declared ${declaredAbsent} but now exists in the table too. ` +
          `Either remove the declaration or remove the row — a declared asymmetry that is no longer true is worse than none.`,
      );
    }
    continue;
  }
  if (!dbValues.has(key)) {
    problems.push(
      `${key} = ${JSON.stringify(tsValue)} is in the module but NOT in recovery_constants. ` +
        `Any database function reading it would raise; add it, or declare it TS-only with a reason.`,
    );
    continue;
  }
  const dbValue = dbValues.get(key);
  if (typeof tsValue === "boolean") {
    problems.push(
      `${key} is a boolean in the module but a numeric row in the table. ` +
        `Give the table a boolean column rather than encoding it as ${dbValue}.`,
    );
    continue;
  }
  if (Number(tsValue) !== dbValue) {
    problems.push(
      `${key} DISAGREES — module ${tsValue}, database ${dbValue}. ` +
        `Whichever is wrong, one half of the product is already using the other.`,
    );
  }
}

if (dbRead) for (const key of dbValues.keys()) {
  if (!tsFlat.has(key)) {
    problems.push(
      `${key} = ${dbValues.get(key)} is in recovery_constants but NOT in the module. ` +
        `A component needing it would have to write the literal, which §10 forbids.`,
    );
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

const compared = [...tsFlat.keys()].filter((k) => !TS_ONLY[k] && !DERIVED[k]).length;

if (problems.length) {
  fail([
    `recovery constants DISAGREE (${problems.length} problem(s)):\n`,
    ...problems.map((p) => `  - ${p}`),
  ]);
} else if (process.exitCode !== 1 && OFFLINE) {
  console.log(
    `recovery constants, MODULE HALF ONLY (--offline): ${tsValues.size} constant(s) parsed, ` +
      `${Object.keys(DERIVED).length} derived and re-derived (${Object.keys(DERIVED).join(", ")}), ` +
      `${Object.keys(EXPANSIONS).length} array expansion(s) checked, ` +
      `every declared name confirmed present in the module.\n` +
      `  The two homes were NOT compared — that needs SUPABASE_ACCESS_TOKEN. This run cannot say they agree.`,
  );
} else if (process.exitCode !== 1) {
  console.log(
    `recovery constants agree: ${compared} key(s) matched across both homes, ` +
      `${Object.keys(DERIVED).length} derived and re-derived (${Object.keys(DERIVED).join(", ")}), ` +
      `${Object.keys(TS_ONLY).length} declared TS-only (${Object.keys(TS_ONLY).join(", ")}), ` +
      `${Object.keys(EXPANSIONS).length} array expansion(s) checked. ` +
      `Every declared name was confirmed present in the module.\n` +
      `  read via: ${connection}`,
  );
}
