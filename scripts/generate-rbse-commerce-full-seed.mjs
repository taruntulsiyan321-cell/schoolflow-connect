/**
 * Generates idempotent SQL migrations for full RBSE Commerce 11–12 coverage.
 * Run: node scripts/generate-rbse-commerce-full-seed.mjs
 *
 * Keeps starter seed_rbse_commerce_v1 untouched; writes seed_rbse_commerce_full_v1.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { emitRow, SOURCE, buildFileSql } from "./rbse-commerce-full/emit.mjs";
import { assertChapterCoverage } from "./rbse-commerce-full/util.mjs";
import { accountancyBank, ACCOUNTANCY_CHAPTERS } from "./rbse-commerce-full/bank-accountancy.mjs";
import { bstBank, BST_CHAPTERS } from "./rbse-commerce-full/bank-bst.mjs";
import { economicsBank, ECONOMICS_CHAPTERS } from "./rbse-commerce-full/bank-economics.mjs";
import { mathematicsBank, MATHEMATICS_CHAPTERS } from "./rbse-commerce-full/bank-mathematics.mjs";
import { englishBank, ENGLISH_CHAPTERS } from "./rbse-commerce-full/bank-english.mjs";
import { hindiBank, HINDI_CHAPTERS } from "./rbse-commerce-full/bank-hindi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, "../supabase/migrations");

const SUBJECTS = [
  { name: "Accountancy", bank: accountancyBank, chapters: ACCOUNTANCY_CHAPTERS },
  { name: "Business Studies", bank: bstBank, chapters: BST_CHAPTERS },
  { name: "Economics", bank: economicsBank, chapters: ECONOMICS_CHAPTERS },
  { name: "Mathematics", bank: mathematicsBank, chapters: MATHEMATICS_CHAPTERS },
  { name: "English", bank: englishBank, chapters: ENGLISH_CHAPTERS },
  { name: "Hindi", bank: hindiBank, chapters: HINDI_CHAPTERS },
];

/** Split into migration files by subject groups to keep editor-friendly sizes. */
const FILES = [
  {
    file: "20260802230000_rbse_commerce_full_accountancy_bst.sql",
    label: "Accountancy + Business Studies",
    subjects: ["Accountancy", "Business Studies"],
  },
  {
    file: "20260802230100_rbse_commerce_full_economics_math.sql",
    label: "Economics + Mathematics",
    subjects: ["Economics", "Mathematics"],
  },
  {
    file: "20260802230200_rbse_commerce_full_english_hindi.sql",
    label: "English + Hindi",
    subjects: ["English", "Hindi"],
  },
];

function collect() {
  /** @type {Record<string, {subject:string, classLevel:number, item:any}[]>} */
  const bySubject = {};
  const summary = [];
  let total = 0;
  let failed = false;

  for (const s of SUBJECTS) {
    const data = s.bank();
    bySubject[s.name] = [];
    for (const cls of [11, 12]) {
      const items = data[cls] || [];
      const { missing, thin } = assertChapterCoverage(
        items,
        s.name,
        cls,
        s.chapters[cls],
        8,
      );
      if (missing.length || thin.length) failed = true;
      const concepts = new Set(items.map((i) => `${i.ch}::${i.concept}`));
      summary.push({
        subject: s.name,
        classLevel: cls,
        chapters: s.chapters[cls].length,
        questions: items.length,
        concepts: concepts.size,
        minPerChapter: Math.min(
          ...s.chapters[cls].map(
            (ch) => items.filter((i) => i.ch === ch).length || 0,
          ),
        ),
      });
      total += items.length;
      for (const item of items) {
        bySubject[s.name].push({ subject: s.name, classLevel: cls, item });
      }
    }
  }

  if (failed) {
    console.error("Coverage validation FAILED — fix banks before emitting SQL.");
    process.exit(1);
  }

  return { bySubject, summary, total };
}

function main() {
  const { bySubject, summary, total } = collect();
  const allRowsSql = [];

  for (const f of FILES) {
    const rows = [];
    let fpSubject = null;
    let fpClass = null;
    let fpChapter = null;

    for (const subj of f.subjects) {
      for (const row of bySubject[subj]) {
        if (!fpSubject) {
          fpSubject = row.subject;
          fpClass = row.classLevel;
          fpChapter = row.item.ch;
        }
        rows.push(emitRow(row.subject, row.classLevel, row.item));
      }
    }

    const subjectsList = f.subjects.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ");
    const sql = buildFileSql(f.label, rows, fpChapter, fpSubject, fpClass, subjectsList);
    const outPath = path.join(MIG_DIR, f.file);
    fs.writeFileSync(outPath, sql, "utf8");
    console.log(`Wrote ${outPath} (${rows.length} rows)`);
    allRowsSql.push(`-- ===== ${f.file} =====\n` + sql);
  }

  // Combined apply helper for clipboard/docs (not a migration timestamp)
  const combinedPath = path.join(__dirname, "../docs/APPLY_RBSE_COMMERCE_FULL.sql");
  const combined =
    `-- Combined apply script for RBSE Commerce full coverage v1\n` +
    `-- source=${SOURCE} | total MCQs=${total}\n` +
    `-- Apply after schema + starter seed. Idempotent per-file fingerprints.\n` +
    `-- Generated ${new Date().toISOString().slice(0, 10)}\n\n` +
    allRowsSql.join("\n\n");
  fs.writeFileSync(combinedPath, combined, "utf8");
  console.log(`Wrote ${combinedPath}`);

  // Machine-readable summary
  const sumPath = path.join(__dirname, "../scripts/rbse-commerce-full/COVERAGE_SUMMARY.json");
  fs.writeFileSync(
    sumPath,
    JSON.stringify({ source: SOURCE, total, summary }, null, 2),
    "utf8",
  );

  console.log("\n=== COVERAGE SUMMARY ===");
  console.log("Total MCQs:", total);
  for (const row of summary) {
    console.log(
      `  ${row.subject} Class ${row.classLevel}: ${row.questions} Q across ${row.chapters} ch (min/ch=${row.minPerChapter}, concepts=${row.concepts})`,
    );
  }
}

main();
