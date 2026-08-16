/**
 * Compiles cached per-chapter JSON (from gen-via-openrouter.mjs) into one
 * idempotent SQL migration for a subject. Run only after generation for that
 * subject is complete (or partially complete — it emits whatever is cached).
 *
 * Usage:
 *   node scripts/rbse-commerce-full/compile-cache-to-migration.mjs <subject-key> <migration-timestamp>
 * Example:
 *   node scripts/rbse-commerce-full/compile-cache-to-migration.mjs accountancy 20260808140000
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, ".gen-cache");
const MIG_DIR = path.join(__dirname, "../../supabase/migrations");

const SOURCE_PREFIX = "seed_rbse_commerce_deepen_";

function esc(s) {
  return String(s).replace(/'/g, "''");
}
function optsJson(o) {
  return JSON.stringify(o).replace(/'/g, "''");
}

function emitRow(source, subject, classLevel, chapter, item) {
  const diff = item.diff || "medium";
  const concept = item.concept || null;
  return `  (
    ${classLevel},
    '${esc(subject)}',
    '${esc(chapter)}',
    ${concept ? `'${esc(concept)}'` : "NULL"},
    '${diff}',
    '${esc(item.q)}',
    '${optsJson(item.o)}'::jsonb,
    ${item.c},
    '${esc(item.e)}',
    '${source}',
    true,
    'rbse',
    'ncert_aligned',
    ${concept ? `'${esc(concept)}'` : "NULL"},
    NULL,
    'commerce',
    'mcq'
  )`;
}

function main() {
  const subjectKey = process.argv[2];
  const timestamp = process.argv[3];
  if (!subjectKey || !timestamp) {
    console.error("Usage: node compile-cache-to-migration.mjs <subject-key> <migration-timestamp>");
    process.exit(1);
  }

  const cacheSubjectDir = path.join(CACHE_DIR, subjectKey);
  if (!fs.existsSync(cacheSubjectDir)) {
    console.error(`No cache dir found: ${cacheSubjectDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(cacheSubjectDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No cached chapters found — nothing to compile.");
    process.exit(1);
  }

  const source = SOURCE_PREFIX + subjectKey + "_v1";
  const rows = [];
  let subjectName = null;
  const chapterCounts = {};

  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(cacheSubjectDir, f), "utf8"));
    subjectName = data.subject;
    const key = `${data.classLevel} — ${data.chapter}`;
    chapterCounts[key] = (chapterCounts[key] || 0) + data.items.length;
    for (const item of data.items) {
      rows.push(emitRow(source, data.subject, data.classLevel, data.chapter, item));
    }
  }

  const values = rows.join(",\n");
  const sql = `-- ============================================================================
-- RBSE Commerce deepening batch — ${subjectName}
-- source='${source}' | board=rbse | stream=commerce | question_format=mcq
-- Generated via OpenRouter (Gemini 2.5 Flash), cached per-chapter, compiled by
-- scripts/rbse-commerce-full/compile-cache-to-migration.mjs
-- Rows in this file: ${rows.length}
-- Idempotent: skips entirely if this source already has >= ${rows.length} rows.
-- ============================================================================

DO $seed$
DECLARE
  _existing int;
BEGIN
  SELECT count(*) INTO _existing FROM public.question_bank WHERE source = '${source}';
  IF _existing >= ${rows.length} THEN
    RAISE NOTICE 'Skip ${esc(subjectName)} deepen batch: already seeded (% rows)', _existing;
    RETURN;
  END IF;

  DELETE FROM public.question_bank WHERE source = '${source}';

  INSERT INTO public.question_bank (
    class_level, subject, chapter, topic, difficulty, question, options, correct_index,
    explanation, source, is_approved,
    board, source_type, concept, school_id, stream, question_format
  ) VALUES
${values};

  RAISE NOTICE 'Inserted ${esc(subjectName)} deepen batch: ${rows.length} MCQs';
END
$seed$;
`;

  const outPath = path.join(MIG_DIR, `${timestamp}_rbse_commerce_deepen_${subjectKey}.sql`);
  fs.writeFileSync(outPath, sql, "utf8");
  console.log(`Wrote ${outPath} (${rows.length} rows across ${files.length} chapters)`);
  console.log("\nPer-chapter counts:");
  for (const [k, n] of Object.entries(chapterCounts)) {
    console.log(`  ${k}: ${n}`);
  }
}

main();
