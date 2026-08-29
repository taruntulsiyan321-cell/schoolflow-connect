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

/**
 * Overridable so the negative control can point at a deliberately broken copy
 * and prove this gate reports failure, without editing the real module or
 * mutating the live table to do it.
 */
const MODULE_PATH = process.env.RECOVERY_CONSTANTS_MODULE || "src/academic/recovery/constants.ts";

/**
 * Declared asymmetries. Every entry is a place the two homes are ALLOWED to
 * differ, and each needs a reason that survives being read aloud. Anything not
 * listed here must exist in both. Keep this list short: each line is a place
 * the gate stops looking.
 */
const TS_ONLY = {
  RECOVERY_SESSION_SIZE:
    "derived from the four tier counts, so storing it would be a third home for a fact those four already determine. Checked by re-deriving it below rather than skipped.",
  VARIANT_CACHE_FIRST:
    "boolean. recovery_constants.value is numeric, and encoding true as 1 is the type-lie that produces a `value > 0` bug later. If a database function needs it, give the table a boolean column then.",
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

// Resolve the one derived value, and prove it is actually derived.
const derived = tsValues.get("RECOVERY_SESSION_SIZE");
if (derived && typeof derived === "object" && "expr" in derived) {
  const tiers = ["RECOVERY_TIER0", "RECOVERY_TIER1", "RECOVERY_TIER2", "RECOVERY_TIER3"];
  const sum = tiers.reduce((a, k) => a + Number(tsValues.get(k) ?? NaN), 0);
  if (Number.isNaN(sum)) {
    console.error("cannot resolve RECOVERY_SESSION_SIZE: a tier constant is missing.");
    process.exit(1);
  }
  const referencesAllTiers = tiers.every((k) => derived.expr.includes(k));
  if (!referencesAllTiers) {
    console.error(
      `RECOVERY_SESSION_SIZE is declared TS-only because it is derived from the four tiers, ` +
        `but its expression does not reference all four: ${derived.expr}`,
    );
    process.exit(1);
  }
  tsValues.set("RECOVERY_SESSION_SIZE", sum);
}

for (const [k, v] of tsValues) {
  if (typeof v === "object" && !Array.isArray(v)) {
    console.error(`${k} is an expression this gate cannot evaluate: ${v.expr}`);
    process.exit(1);
  }
}

// ── Read the table ─────────────────────────────────────────────────────────

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
if (!MGMT) {
  console.error("No SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: "SELECT key, value FROM public.recovery_constants ORDER BY key" }),
});
const text = await res.text();

/**
 * Everything from here sets process.exitCode and lets the process end, rather
 * than calling process.exit(). Calling exit() after a fetch tears down undici's
 * in-flight handles and aborts with a libuv assertion, so the shell sees 127
 * instead of 1 — a gate reporting a code it did not choose. 127 is still
 * non-zero and CI would still fail, but a gate that cannot state its own
 * result accurately is the wrong thing to trust the rest of this with.
 */
function fail(lines) {
  for (const l of [].concat(lines)) console.error(l);
  process.exitCode = 1;
}

let rows;
try {
  rows = JSON.parse(text);
} catch {
  fail(`could not read recovery_constants: HTTP ${res.status} ${text.slice(0, 200)}`);
}

if (process.exitCode !== 1 && (!Array.isArray(rows) || rows.length === 0)) {
  fail(
    `recovery_constants returned no rows (${JSON.stringify(rows).slice(0, 200)}). ` +
      `An empty table would let every module constant look "absent from the database" ` +
      `rather than mismatched, so this is a failure, not a pass.`,
  );
}

const dbValues = new Map(
  Array.isArray(rows) ? rows.map((r) => [r.key, Number(r.value)]) : [],
);

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

for (const [key, tsValue] of tsFlat) {
  if (TS_ONLY[key]) {
    if (dbValues.has(key)) {
      problems.push(
        `${key} is declared TS-only but now exists in the table too. ` +
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

for (const key of dbValues.keys()) {
  if (!tsFlat.has(key)) {
    problems.push(
      `${key} = ${dbValues.get(key)} is in recovery_constants but NOT in the module. ` +
        `A component needing it would have to write the literal, which §10 forbids.`,
    );
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

const compared = [...tsFlat.keys()].filter((k) => !TS_ONLY[k]).length;

if (problems.length) {
  fail([
    `recovery constants DISAGREE (${problems.length} problem(s)):\n`,
    ...problems.map((p) => `  - ${p}`),
  ]);
} else if (process.exitCode !== 1) {
  console.log(
    `recovery constants agree: ${compared} key(s) matched across both homes, ` +
      `${Object.keys(TS_ONLY).length} declared TS-only (${Object.keys(TS_ONLY).join(", ")}), ` +
      `${Object.keys(EXPANSIONS).length} array expansion(s) checked.`,
  );
}
