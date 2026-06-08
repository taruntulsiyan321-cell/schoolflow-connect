/**
 * Build ONE SQL file for Lovable: all pending migrations + Class 12 math seed.
 * Run: npm run db:generate-lovable-paste
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PENDING_FILES = [
  "20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql",
  "20260516000000_inquiries_complaints.sql",
  "20260604030000_student_panel_fixes.sql",
  "20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql",
  "20260604080000_battle_monitor.sql",
  "20260604100000_battleground_phase4.sql",
  "20260605000000_student_portal_login.sql",
  "20260606000000_student_success_platform.sql",
  "20260607000000_student_success_phase2.sql",
  "20260608000000_student_success_phase3.sql",
  "20260604120000_demo_data.sql",
  "20260609000000_fix_quick_battle_overload.sql",
  "20260610000000_battleground_overhaul.sql",
  "20260611000000_question_template_engine.sql",
  "20260612000000_ai_and_audit_fixes.sql",
  "20260613000000_concept_mastery_recovery.sql",
  "20260614000000_unify_practice_analytics.sql",
  "20260615000000_battle_template_fallback.sql",
];

const OUT = join(ROOT, "supabase", "LOVABLE_PASTE_ALL_PENDING.sql");
const CONTINUE = join(ROOT, "supabase", "LOVABLE_CONTINUE_FROM_DEMO.sql");
const MATH = join(ROOT, "supabase", "seeds", "class12_math_templates.sql");

const CONTINUE_FROM = "20260604120000_demo_data.sql";

const parts = [
  `-- =============================================================================
-- LOVABLE — PASTE THIS ENTIRE FILE ONCE
-- Project database: kdmjipeksjdyojjdokbi (Lovable Cloud Supabase)
-- Open Lovable → your SchoolFlow project → Supabase → SQL Editor → New query
-- Paste everything below → Run (single click, no batches)
-- =============================================================================
`,
];

for (const f of PENDING_FILES) {
  const path = join(ROOT, "supabase", "migrations", f);
  if (!existsSync(path)) {
    console.error(`Missing: ${path}`);
    process.exit(1);
  }
  parts.push(`\n-- ========== ${f} ==========\n\n`);
  parts.push(readFileSync(path, "utf8"));
  parts.push("\n");
}

if (existsSync(MATH)) {
  parts.push(`\n-- ========== class12_math_templates.sql (seed) ==========\n\n`);
  parts.push(readFileSync(MATH, "utf8"));
}

const sql = parts.join("");
writeFileSync(OUT, sql, "utf8");

const continueIdx = PENDING_FILES.indexOf(CONTINUE_FROM);
if (continueIdx >= 0) {
  const contParts = [
    `-- Continue after a partial run failed in demo_data. Paste and RUN once.\n`,
    `ALTER TABLE public.library_books ADD COLUMN IF NOT EXISTS shelf_location TEXT DEFAULT '';\n\n`,
  ];
  for (const f of PENDING_FILES.slice(continueIdx)) {
    contParts.push(`\n-- ========== ${f} ==========\n\n`);
    contParts.push(readFileSync(join(ROOT, "supabase", "migrations", f), "utf8"));
    contParts.push("\n");
  }
  if (existsSync(MATH)) {
    contParts.push(`\n-- ========== class12_math_templates.sql ==========\n\n`);
    contParts.push(readFileSync(MATH, "utf8"));
  }
  writeFileSync(CONTINUE, contParts.join(""), "utf8");
}

const kb = (Buffer.byteLength(sql) / 1024).toFixed(1);
const contKb = existsSync(CONTINUE) ? (Buffer.byteLength(readFileSync(CONTINUE)) / 1024).toFixed(1) : "n/a";
console.log(`Wrote ${OUT}`);
console.log(`Wrote ${CONTINUE} (${contKb} KB)`);
console.log(`Full size: ${kb} KB | Migrations: ${PENDING_FILES.length} | Includes math seed: ${existsSync(MATH)}`);
