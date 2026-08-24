/**
 * Static guardrail against the "internal value reached the screen" bug class.
 *
 * The 2026-08-23 rendering-integrity audit found five distinct ways a raw
 * internal value could become user-facing text, each repeated across many
 * files because there was no shared boundary to route it through:
 *
 *   1. a caught error's `.message` (raw PostgREST text naming tables,
 *      constraints and functions) rendered straight into the DOM;
 *   2. a UUID or UUID fragment used as a person's display name;
 *   3. a database enum token (`half_day`, `in_progress`) rendered directly,
 *      sometimes with a cosmetic `capitalize` that only made it `Half_day`;
 *   4. `String(...)` / `JSON.stringify(...)` coercing an unknown value inside
 *      JSX, which yields `[object Object]` the moment the value is not what
 *      the author assumed;
 *   5. ad-hoc humanization (`.replace(/_/g, " ")`) duplicated per page instead
 *      of one registry.
 *
 * `src/lib/presentation` is the boundary that replaces all five. This check
 * exists so the next feature cannot quietly reintroduce them.
 *
 * It is a heuristic on source text, not a type checker. Anything it flags
 * needs either a real fix or an ALLOWLIST entry with a specific reason — an
 * allowlist of unexplained exceptions would defeat the point.
 *
 * Run: node scripts/lint-render-safety.mjs
 * Exit 0 = clean. Exit 1 = at least one finding needs a fix or a reason.
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname, relative, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/**
 * Files exempt from a specific rule, each with a reason that can be checked.
 * Key format: "<posix path>::<rule id>".
 */
const ALLOWLIST = {
  "src/lib/presentation/safeText.ts::coerce-in-jsx":
    "This module IS the boundary; it is the one place allowed to inspect raw values.",
  "src/lib/presentation/errors.ts::raw-error-message":
    "This module IS the error boundary; it reads .message in order to screen it.",
  "src/lib/presentation/enums.ts::ad-hoc-humanize":
    "This module IS the enum registry; humanizeEnumValue is the canonical implementation.",
  "src/pages/student/_debug/WeakAreasV2Debug.tsx::coerce-in-jsx":
    "Internal debug tool, mounted only under import.meta.env.DEV (see StudentDashboard.tsx).",
  "src/pages/student/_debug/WeakAreasV2Debug.tsx::raw-enum-render":
    "Internal debug tool, mounted only under import.meta.env.DEV; showing raw values is its purpose.",

  // Telemetry, not UI. These strings are machine codes consumed by benchmark
  // and embedding-job records; routing them through toErrorMessage would
  // replace real diagnostics with a generic sentence nobody can debug from.
  "src/academic/ai/benchmarkSuite.ts::raw-error-message":
    "Benchmark/gate telemetry payload, never rendered; the raw message is the diagnostic value.",
  "src/academic/ai/embeddingProvider.ts::raw-error-message":
    "Embedding-job failure record persisted for operators, never rendered to a user.",
  "src/academic/ai/feedbackLoop.ts::raw-error-message":
    "Feedback-insert failure record returned to callers for logging, never rendered.",

  // These build lookup/alias keys, not display strings. The underscore removal
  // is part of matching, and its output never reaches the DOM.
  "src/academic/taxonomy/canonicalize.ts::ad-hoc-humanize":
    "Builds a canonical match key, not a label; output is compared, never rendered.",
  "src/academic/taxonomy/registry.ts::ad-hoc-humanize":
    "Generates search aliases for term lookup; aliases are matched against, never displayed.",
  "src/academic/taxonomy/seeds/commerceRbse.ts::ad-hoc-humanize":
    "Seed data alias generation for taxonomy matching; not a display path.",

  // Mojibake here is DATA, not corruption: the patterns that detect it, the
  // fixtures that test it, and comments that illustrate it. Repairing these
  // would disable the machinery that keeps mojibake off the screen. The same
  // list is mirrored in scripts/repair-source-mojibake.cjs (EXCLUDED).
  "src/lib/utf8MojibakeRepair.ts::source-mojibake":
    "Contains UTF8_MOJIBAKE_SIGNATURE — the detection regex itself.",
  "src/lib/utf8MojibakeRepair.test.ts::source-mojibake":
    "Test fixtures are deliberately mojibake.",
  "src/lib/utf8Text.ts::source-mojibake":
    "CONTENT_MOJIBAKE map — the left-hand side must stay corrupted to match.",
  "src/lib/utf8Mojibake.ts::source-mojibake":
    "Deprecated re-export shim for the repair SSOT.",
  "src/lib/repairWin1252Utf8.ts::source-mojibake":
    "Deprecated re-export shim for the repair SSOT.",
  "src/academic/taxonomy/humanize.ts::source-mojibake":
    "MOJIBAKE_MAP — patterns must stay corrupted to match.",
  "src/lib/academicDisplay.test.ts::source-mojibake":
    "Test fixtures are deliberately mojibake.",
  "src/lib/presentation/presentation.test.ts::source-mojibake":
    "Asserts the boundary repairs mojibake; inputs must stay corrupted.",
  "src/lib/presentation/aiText.test.tsx::source-mojibake":
    "Asserts AI output is repaired; inputs must stay corrupted.",
  "src/academic/services/practiceService.ts::source-mojibake":
    "Mojibake appears only inside an explanatory comment.",
  "src/academic/taxonomy/canonicalize.ts::source-mojibake":
    "Mojibake appears only inside an explanatory comment.",
  "src/pages/shared/QuestionBankPage.tsx::source-mojibake":
    "Remaining sequence is inside a comment illustrating paste corruption.",
};

/** Enum-ish property names that must not be rendered as bare JSX children. */
const ENUM_PROPS = [
  "status",
  "priority",
  "audience",
  "tier",
  "leaveType",
  "eventType",
  "feeStatus",
];

const RULES = [
  {
    id: "raw-error-message",
    // e instanceof Error ? e.message : "..."  -> toErrorMessage(e, "...")
    test: /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*) instanceof Error \? \1\.message : ("|')/,
    message:
      "A caught error's raw .message can be PostgREST text naming tables/constraints. " +
      'Use toErrorMessage(err, "…") from @/lib/presentation.',
    files: /\.(ts|tsx)$/,
  },
  {
    id: "empty-select-item-value",
    // Radix reserves "" for "clear the selection" and THROWS on an empty
    // SelectItem value. It is not a cosmetic issue: it white-screened the
    // whole teacher Question Bank page (found live, 2026-08-24). Use a
    // sentinel value and translate it in onValueChange.
    test: /<SelectItem\s[^>]*value=""/,
    message:
      'A <SelectItem value=""> throws in Radix and blanks the entire page. ' +
      'Use a sentinel (e.g. value="any") and map it back to "" in onValueChange.',
    files: /\.tsx$/,
  },
  {
    id: "raw-error-field",
    // `toast({ description: bErr.message })` — a destructured Supabase error.
    // Same raw PostgREST text as `raw-error-message`, different shape, so the
    // first rule could not see it.
    test: /(description|title|message):\s*[A-Za-z_$][\w$]*\.message\b/,
    message:
      "A Supabase/PostgREST error's raw .message is being shown to the user. " +
      'Use toErrorMessage(err, "…") from @/lib/presentation.',
    files: /\.(ts|tsx)$/,
    refine: (line) => /\b(err|error|Err|Error)\b/.test(line),
  },
  {
    id: "hand-rolled-error-duck-typing",
    test: /"message"\s+in\s+[A-Za-z_$][\w$]*/,
    message:
      "Hand-rolled error duck-typing reproduces the error boundary badly and " +
      "leaks raw driver text. Use toErrorMessage(err, \"…\").",
    files: /\.(ts|tsx)$/,
  },
  {
    id: "uuid-as-name",
    // ?? someId.slice(0, 8)  /  || user_id.slice(0, 8)
    test: /(\?\?|\|\|)\s*[A-Za-z_$][\w$.]*(?:[Ii]d|_id)\b\s*\.slice\(\s*0\s*,/,
    message:
      "An id (or id fragment) is being used as a display name. A missing name is an " +
      'empty state, not an id — use toPersonName(value, { kind: "student" }).',
    files: /\.tsx$/,
  },
  {
    id: "coerce-in-jsx",
    // {String(x)} or {JSON.stringify(x)} as a JSX child
    test: /\{\s*(?:String\(|JSON\.stringify\()/,
    message:
      "Coercing an unknown value inside JSX renders '[object Object]' when it is not a " +
      "string. Use toDisplayText(value) from @/lib/presentation.",
    files: /\.tsx$/,
    refine: (line) => {
      // Only data of unknown shape matters: a plain property access.
      const m = /\{\s*(?:String|JSON\.stringify)\(\s*([A-Za-z_$][\w$]*\.[\w$.?[\]]+)/.exec(line);
      if (!m) return false;
      // `String(d.getMonth() + 1)` — a method call returns a known primitive.
      const rest = line.slice(m.index + m[0].length);
      if (rest.startsWith("(")) return false;
      // Attribute positions that never become visible text.
      const before = line.slice(0, m.index).trimEnd();
      const attr = /([A-Za-z_$][\w$]*)=$/.exec(before);
      if (attr) {
        const TEXT_BEARING = ["value", "label", "title", "subtitle", "text", "message", "name"];
        if (!TEXT_BEARING.includes(attr[1])) return false;
      }
      return true;
    },
  },
  {
    id: "ad-hoc-humanize",
    test: /\.replace\(\s*\/_\/g\s*,\s*["'] ["']\s*\)/,
    message:
      "Ad-hoc token humanization duplicates the enum registry. Use " +
      "toEnumLabel(value, domain) or humanizeEnumValue(value).",
    files: /\.(ts|tsx)$/,
  },
  {
    id: "capitalize-on-enum",
    // A `capitalize` class on the same line as a bare enum-ish render.
    test: new RegExp(
      "capitalize[\\s\\S]{0,200}?\\{[A-Za-z_$][\\w$.?]*\\.(?:" + ENUM_PROPS.join("|") + ")\\}",
    ),
    message:
      "CSS `capitalize` on a raw enum only turns `half_day` into `Half_day`. " +
      "Render toEnumLabel(value, domain) instead and drop the class.",
    files: /\.tsx$/,
  },
  {
    id: "source-mojibake",
    // UTF-8-as-CP1252 sequences baked into the source itself. The runtime
    // boundary screens *data*; it cannot fix a corrupted string literal, which
    // renders exactly as written. 909 of these were introduced on 2026-08-23
    // when a bulk theme edit re-saved 77 files through a CP1252 round-trip.
    test: /â€|Â[·°¹²³½¼¾ ]|Ã[-ÿ]|à¤|à¥|â”€|ðŸ/,
    message:
      "Corrupted (mojibake) text in a source literal. Run " +
      "`node scripts/repair-source-mojibake.cjs --write`. If the sequence is " +
      "deliberate (a detection pattern or test fixture), add the file to that " +
      "script's EXCLUDED map and to this linter's ALLOWLIST.",
    files: /\.(ts|tsx)$/,
  },
  {
    id: "raw-enum-render",
    test: new RegExp("\\{[A-Za-z_$][\\w$.?]*\\.(?:" + ENUM_PROPS.join("|") + ")\\}"),
    message:
      "A database enum token is being rendered directly. Use toEnumLabel(value, domain) " +
      "from @/lib/presentation.",
    files: /\.tsx$/,
    // Only a bare JSX child counts; props like `status={x.status}` are fine.
    refine: (line, raw) => {
      const idx = raw.search(/\{[A-Za-z_$][\w$.?]*\.(?:status|priority|audience|tier)\}/);
      if (idx < 0) return false;
      const before = raw.slice(Math.max(0, idx - 40), idx);
      // `foo={x.status}` / `key={x.status}` are attribute values, not text.
      if (/[A-Za-z-]+=$/.test(before.trimEnd())) return false;
      return true;
    },
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

/** Strip comments so a rule documented in prose is not flagged as code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

function main() {
  const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const findings = [];
  const allowlisted = [];

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    const cleaned = stripComments(source);
    const lines = cleaned.split(/\r?\n/);
    const rawLines = source.split(/\r?\n/);

    for (const rule of RULES) {
      if (!rule.files.test(file)) continue;
      const key = `${rel}::${rule.id}`;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        if (!rule.test.test(line)) continue;
        if (rule.refine && !rule.refine(line, rawLines[i] ?? line)) continue;

        if (ALLOWLIST[key]) {
          allowlisted.push({ key, reason: ALLOWLIST[key] });
          break; // one entry per file+rule is enough
        }
        findings.push({
          rel,
          line: i + 1,
          rule: rule.id,
          message: rule.message,
          snippet: (rawLines[i] ?? line).trim().slice(0, 120),
        });
      }
    }
  }

  console.log(`Scanned ${files.length} source files for unsafe rendering patterns.\n`);

  if (allowlisted.length) {
    const unique = [...new Map(allowlisted.map((a) => [a.key, a])).values()];
    console.log(`${unique.length} allowlisted (reviewed, with a reason):`);
    for (const a of unique) console.log(`  - ${a.key}\n      ${a.reason}`);
    console.log("");
  }

  if (findings.length === 0) {
    console.log("PASS: no unsafe rendering patterns found.");
    process.exit(0);
  }

  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  console.log(`FAIL: ${findings.length} unsafe rendering pattern(s) across ${byRule.size} rule(s):\n`);
  for (const [rule, items] of byRule) {
    console.log(`  [${rule}] ${items[0].message}`);
    for (const f of items) console.log(`      ${f.rel}:${f.line}  ${f.snippet}`);
    console.log("");
  }
  console.log(
    "Each finding needs either a real fix (route the value through " +
      "@/lib/presentation) or an ALLOWLIST entry in this script with a specific reason.",
  );
  process.exit(1);
}

main();
