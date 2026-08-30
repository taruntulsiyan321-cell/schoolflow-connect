/**
 * Print generated variants beside the questions they came from, for a human to read.
 *
 *   node scripts/dump-variants.mjs --tier 2 --limit 20
 *   node scripts/dump-variants.mjs --tier 1 --order recent
 *   node scripts/dump-variants.mjs --chapter <uuid>
 *
 * WHY THIS EXISTS
 * Whether a tier-2 variant genuinely asks the same idea in a different frame,
 * or just reshuffles the words of the original, decides whether recovery works
 * at all. Spec 4.2 hangs the most useful thing this feature detects - tier 1
 * pass, tier 2 fail - on that distinction being real. No gate can check it.
 * Twenty real pairs read by a person beat any green verification block.
 *
 * WHAT THIS TOOL DOES AND DOES NOT DO
 * It does NOT judge. It shows the pair and it ORDERS THE QUEUE, so twenty reads
 * land on the twenty most likely to be lazy rather than twenty random ones. The
 * overlap figure beside each pair is a reading hint and nothing else: high
 * overlap often means a reworded clone, but a genuine tier-1 variant SHOULD
 * share most of its wording (4.2a: "same question, different values"), and a
 * lazy tier-2 can score low by swapping synonyms. Sort by it; do not conclude
 * from it.
 */
import { readFileSync, existsSync } from "fs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const TIER = arg("tier", null);
const LIMIT = Number(arg("limit", 20));
const CHAPTER = arg("chapter", null);
const ORDER = arg("order", "overlap");

if (!["overlap", "recent", "random"].includes(ORDER)) {
  console.error("--order must be overlap | recent | random");
  process.exit(2);
}

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("No SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(2);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!Array.isArray(out)) throw new Error(JSON.stringify(out).slice(0, 300));
  return out;
}

const conditions = ["v.source_question_id IS NOT NULL"];
conditions.push(TIER ? `v.variant_tier = ${Number(TIER)}` : "v.variant_tier IS NOT NULL");
if (CHAPTER) conditions.push(`v.chapter_id = '${CHAPTER.replace(/'/g, "''")}'`);
const where = conditions.join(" AND ");

const rows = await sql(`
  SELECT v.id, v.variant_tier, v.difficulty AS v_diff, v.question AS v_q,
         v.options AS v_opts, v.correct_index AS v_ci, v.explanation AS v_exp,
         v.created_at, v.is_approved, v.is_active,
         o.id AS o_id, o.difficulty AS o_diff, o.question AS o_q,
         o.options AS o_opts, o.correct_index AS o_ci, o.explanation AS o_exp,
         coalesce(c.name, v.chapter) AS chapter_name, v.topic, v.subject
    FROM public.question_bank v
    JOIN public.question_bank o ON o.id = v.source_question_id
    LEFT JOIN public.chapters c ON c.id = v.chapter_id
   WHERE ${where}
   ORDER BY v.created_at DESC
   LIMIT 2000`);

// -- The empty case is a FINDING, not a clean report -------------------------
if (rows.length === 0) {
  const counts = await sql(
    "SELECT count(*) FILTER (WHERE source_question_id IS NOT NULL) AS variants, count(*) AS bank FROM public.question_bank",
  );
  const variants = Number(counts[0]?.variants ?? 0);
  const bank = Number(counts[0]?.bank ?? 0);
  const lines = [
    "No variants matched.",
    "",
    `  question_bank holds ${bank} question(s), of which ${variants} are variants.`,
    "",
  ];
  if (variants === 0) {
    lines.push(
      "  Nothing has ever been generated. This tool has nothing to show, and that",
      "  is the finding: 4.2a's shared-bank economics -- \"a variant generated",
      "  because Ravi failed a question is there, free and instant, for the next",
      "  student who fails the same one\" -- has not started paying yet, because",
      "  the generation path is not built.",
    );
  } else {
    lines.push("  Variants exist but none match these filters -- widen --tier / --chapter.");
  }
  lines.push(
    "",
    "  Printing an empty report as though it were a clean one is the failure this",
    "  refuses to commit.",
  );
  console.error(lines.join("\n"));
  process.exit(1);
}

// -- Reading hint: token overlap between variant and original ---------------
const STOP = new Set(
  "a an the of to in on for is are was were and or if it its as at by with from be been that this which what".split(" "),
);
function tokens(s) {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
function overlap(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

for (const r of rows) r._ov = overlap(r.v_q, r.o_q);
if (ORDER === "overlap") rows.sort((a, b) => b._ov - a._ov);
else if (ORDER === "random") rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));

const show = rows.slice(0, LIMIT);

function optionText(options, idx) {
  const list = Array.isArray(options) ? options : [];
  const v = list[idx];
  if (v === undefined) return "(no option at that index)";
  return String(typeof v === "object" ? JSON.stringify(v) : v);
}

function block(label, q, options, ci, exp, diff) {
  const list = Array.isArray(options) ? options : [];
  const out = [`  ${label}  [difficulty: ${diff ?? "?"}]`];
  for (const l of String(q ?? "").split("\n")) out.push(`    ${l}`);
  list.forEach((o, i) => {
    const mark = i === ci ? ">" : " ";
    const text = typeof o === "object" ? JSON.stringify(o) : o;
    out.push(`      ${mark} ${String.fromCharCode(65 + i)}. ${text}`);
  });
  out.push(exp ? `    why: ${String(exp).replace(/\s+/g, " ").slice(0, 300)}` : "    why: (none recorded)");
  return out.join("\n");
}

console.log(`${show.length} of ${rows.length} matching variant(s), ordered by ${ORDER}.`);
console.log("Overlap is a READING HINT, not a verdict - high is normal for tier 1, suspicious for tier 2.");
console.log("");

let i = 0;
for (const r of show) {
  i++;
  const flags = `${r.is_approved ? "approved" : "UNAPPROVED"}${r.is_active ? "" : " · INACTIVE"}`;
  console.log("=".repeat(78));
  console.log(
    `#${i}  tier ${r.variant_tier}  ·  ${r.subject ?? "?"} / ${r.chapter_name ?? "?"} / ${r.topic ?? "?"}` +
      `  ·  overlap ${(r._ov * 100).toFixed(0)}%  ·  ${flags}`,
  );
  console.log(`     variant ${r.id}  <-  original ${r.o_id}`);
  console.log("");
  console.log(block("ORIGINAL (what they got wrong)", r.o_q, r.o_opts, r.o_ci, r.o_exp, r.o_diff));
  console.log("");
  console.log(block(`VARIANT tier ${r.variant_tier}`, r.v_q, r.v_opts, r.v_ci, r.v_exp, r.v_diff));
  console.log("");

  const sameAnswer =
    optionText(r.o_opts, r.o_ci).trim().toLowerCase() === optionText(r.v_opts, r.v_ci).trim().toLowerCase();
  const rule =
    r.variant_tier === 1
      ? "tier 1 must preserve the method and change only values, names or context (4.2a)"
      : r.variant_tier === 2
        ? "tier 2 must preserve the CONCEPT and change the STRUCTURE - reverse what is given and asked, embed it in a different scenario, or ask for a different output of the same idea (4.2a)"
        : "tier 3: same topic, different application (4.2)";
  const diffNote =
    String(r.o_diff) === String(r.v_diff)
      ? `same difficulty (${r.o_diff ?? "?"}) - matches`
      : `difficulty DIFFERS: original ${r.o_diff ?? "?"} vs variant ${r.v_diff ?? "?"} - 4.2 says variants mirror what was failed`;
  const answerNote = sameAnswer
    ? "identical correct-answer text - expected for tier 1, a smell for tier 2"
    : "different correct-answer text";

  console.log(`  read against: ${rule}`);
  console.log(`                ${diffNote}`);
  console.log(`                ${answerNote}`);
  console.log("");
}

console.log("=".repeat(78));
console.log("Read " + show.length + ". The question to answer is the one no gate can:");
console.log("does the variant ask the same idea differently, or reshuffle the same words?");
console.log("If it reshuffles, the tier-1-pass / tier-2-fail signal 4.2 is built on does not exist.");
