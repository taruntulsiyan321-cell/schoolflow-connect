/**
 * Repair UTF-8-as-CP1252 mojibake that was baked into SOURCE FILES.
 *
 * WHY THIS IS SEPARATE FROM THE RUNTIME LAYER
 * -------------------------------------------
 * `src/lib/presentation` screens *data* on its way to the screen. It cannot
 * help with corruption that lives in the code itself:
 *
 *     <Loading label="Loading homeworkâ€¦" />        // should be "…"
 *     {`${a} Â· ${b}`}                              // should be "·"
 *
 * Those literals render exactly as written. The 2026-08-23 theme commits
 * re-saved 77 files through a CP1252 round-trip and left 724 such sequences.
 *
 * WHY IT IS SAFE
 * --------------
 * A whole-file byte round-trip would fail on any file that also contains
 * legitimate non-Latin-1 text (real "…", "π", Devanagari), because those
 * characters have no CP1252 byte. So this repairs *runs* instead: it finds
 * each maximal candidate sequence, attempts a strict UTF-8 decode of its
 * CP1252 bytes, and replaces it only when the decode succeeds cleanly and
 * actually changes the text. Anything ambiguous is left alone.
 *
 * Usage:
 *   node scripts/repair-source-mojibake.cjs            # dry run, prints a report
 *   node scripts/repair-source-mojibake.cjs --write    # apply
 */
const fs = require("fs");
const path = require("path");

const WRITE = process.argv.includes("--write");
const ROOTS = ["src", "e2e"];
const EXT = /\.(ts|tsx|css)$/;

/**
 * Files where mojibake sequences are DATA, not corruption: the patterns that
 * detect it, the fixtures that test it, and comments that illustrate it.
 * "Repairing" these would silently disable the very machinery that keeps
 * mojibake off the screen — the encoding equivalent of deleting a smoke alarm
 * because it smells of smoke.
 */
const EXCLUDED = new Map([
  ["src/lib/utf8MojibakeRepair.ts", "Contains UTF8_MOJIBAKE_SIGNATURE — the detection regex itself."],
  ["src/lib/utf8MojibakeRepair.test.ts", "Test fixtures are deliberately mojibake."],
  ["src/lib/utf8Text.ts", "CONTENT_MOJIBAKE map — the left-hand side must stay corrupted to match."],
  ["src/lib/utf8Mojibake.ts", "Deprecated re-export shim for the repair SSOT."],
  ["src/lib/repairWin1252Utf8.ts", "Deprecated re-export shim for the repair SSOT."],
  ["src/academic/taxonomy/humanize.ts", "MOJIBAKE_MAP — patterns must stay corrupted to match."],
  ["src/lib/academicDisplay.test.ts", "Test fixtures are deliberately mojibake."],
  ["src/lib/presentation/presentation.test.ts", "Asserts the boundary repairs mojibake; inputs must stay corrupted."],
  ["src/lib/presentation/aiText.test.tsx", "Asserts AI output is repaired; inputs must stay corrupted."],
  ["e2e/render-safety-public.spec.ts", "FORBIDDEN_TEXT includes a mojibake detection pattern."],
  ["src/academic/services/practiceService.ts", "Mojibake appears only inside an explanatory comment."],
  ["src/academic/taxonomy/canonicalize.ts", "Mojibake appears only inside an explanatory comment."],
  ["src/pages/shared/QuestionBankPage.tsx", "Remaining sequence is inside a comment illustrating paste corruption."],
]);

/** CP1252 byte (0x80-0x9F) -> Unicode codepoint. */
const CP1252_BYTE_TO_CP = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const CP_TO_BYTE = new Map(
  Object.entries(CP1252_BYTE_TO_CP).map(([b, cp]) => [cp, Number(b)]),
);

/** Characters that can appear inside a mojibake run. */
function isRunChar(cp) {
  if (cp >= 0xa0 && cp <= 0xff) return true; // Latin-1 supplement
  return CP_TO_BYTE.has(cp); // CP1252 specials (…, ', ", –, —, •, †, ˆ …)
}

/** A run must begin with a plausible UTF-8 lead byte to be worth decoding. */
function isLeadChar(cp) {
  return cp >= 0xc2 && cp <= 0xf4;
}

function runToBytes(run) {
  const bytes = [];
  for (const ch of run) {
    const cp = ch.codePointAt(0);
    const mapped = CP_TO_BYTE.get(cp);
    if (mapped != null) bytes.push(mapped);
    else if (cp <= 0xff) bytes.push(cp);
    else return null;
  }
  return Uint8Array.from(bytes);
}

function decodeStrict(bytes) {
  try {
    const out = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!out || out.includes("�")) return null;
    return out;
  } catch {
    return null;
  }
}

/** Repair every decodable mojibake run in `text`. */
function repairRuns(text) {
  let out = "";
  let i = 0;
  let repairs = 0;
  const samples = [];

  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (!isLeadChar(cp)) {
      out += text[i];
      i += 1;
      continue;
    }
    // Extend the run as far as run-characters allow.
    let j = i;
    while (j < text.length && isRunChar(text.codePointAt(j))) j += 1;

    // Try the longest run first, shrinking until something decodes.
    let done = false;
    for (let end = j; end > i + 1; end -= 1) {
      const run = text.slice(i, end);
      const bytes = runToBytes(run);
      if (!bytes) continue;
      const decoded = decodeStrict(bytes);
      if (decoded == null || decoded === run) continue;
      out += decoded;
      repairs += 1;
      if (samples.length < 3) samples.push(`${JSON.stringify(run)} -> ${JSON.stringify(decoded)}`);
      i = end;
      done = true;
      break;
    }
    if (!done) {
      out += text[i];
      i += 1;
    }
  }
  return { text: out, repairs, samples };
}

const files = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (EXT.test(entry.name)) files.push(p);
    }
  })(root);
}

let totalRepairs = 0;
let changedFiles = 0;
const report = [];

const skipped = [];
for (const file of files) {
  const rel = file.split(path.sep).join("/");
  if (EXCLUDED.has(rel)) {
    const original = fs.readFileSync(file, "utf8");
    const { repairs } = repairRuns(original);
    if (repairs > 0) skipped.push({ rel, repairs, reason: EXCLUDED.get(rel) });
    continue;
  }
  const original = fs.readFileSync(file, "utf8");
  const { text, repairs, samples } = repairRuns(original);
  if (repairs === 0 || text === original) continue;
  changedFiles += 1;
  totalRepairs += repairs;
  report.push({ file: rel, repairs, samples });
  if (WRITE) fs.writeFileSync(file, text);
}

if (skipped.length) {
  console.log("Excluded (mojibake is data, not corruption):");
  for (const s of skipped) console.log(`  - ${s.rel} (${s.repairs} left intact)\n      ${s.reason}`);
  console.log("");
}

console.log(
  (WRITE ? "REPAIRED " : "DRY RUN — would repair ") +
    totalRepairs +
    " mojibake run(s) across " +
    changedFiles +
    " file(s)\n",
);
for (const r of report.sort((a, b) => b.repairs - a.repairs).slice(0, 25)) {
  console.log(`  ${r.file}  (${r.repairs})`);
  for (const s of r.samples) console.log(`      ${s}`);
}
if (report.length > 25) console.log(`  … and ${report.length - 25} more files`);
if (!WRITE) console.log("\nRe-run with --write to apply.");
