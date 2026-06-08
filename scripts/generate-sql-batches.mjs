/**
 * Bundle pending migrations into 4-file batches for Supabase SQL Editor.
 * No Lovable credits — paste each batch file directly in:
 * https://supabase.com/dashboard/project/kdmjipeksjdyojjdokbi/sql/new
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "supabase", "sql-batches");
const BATCH_SIZE = 4;

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
];

const LABELS = {
  "20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql": "Admin connect student/teacher",
  "20260516000000_inquiries_complaints.sql": "Inquiries & complaints",
  "20260604030000_student_panel_fixes.sql": "Student panel fixes",
  "20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql": "Combined pending bundle",
  "20260604080000_battle_monitor.sql": "Battle monitor",
  "20260604100000_battleground_phase4.sql": "Battleground phase 4",
  "20260605000000_student_portal_login.sql": "Portal email/phone auto-link",
  "20260606000000_student_success_platform.sql": "Student Success Phase 1",
  "20260607000000_student_success_phase2.sql": "Student Success Phase 2",
  "20260608000000_student_success_phase3.sql": "Student Success Phase 3",
  "20260604120000_demo_data.sql": "Demo users & seed data",
  "20260609000000_fix_quick_battle_overload.sql": "Fix solo quiz RPC overload",
  "20260610000000_battleground_overhaul.sql": "Battleground overhaul",
  "20260611000000_question_template_engine.sql": "Class 12 Math template engine",
  "20260612000000_ai_and_audit_fixes.sql": "Battle report AI fixes",
  "20260613000000_concept_mastery_recovery.sql": "Concept mastery & recovery zone",
};

mkdirSync(OUT, { recursive: true });

const batches = [];
for (let i = 0; i < PENDING_FILES.length; i += BATCH_SIZE) {
  batches.push(PENDING_FILES.slice(i, i + BATCH_SIZE));
}

const readme = [`# SQL batches — paste in Supabase SQL Editor (NO Lovable credits)

Project: **kdmjipeksjdyojjdokbi**

Open: https://supabase.com/dashboard/project/kdmjipeksjdyojjdokbi/sql/new

Run **one batch at a time**, wait for success, then run the next.

| Batch | File | Migrations |
|-------|------|------------|
`];

batches.forEach((files, idx) => {
  const n = idx + 1;
  const outName = `batch-${String(n).padStart(2, "0")}.sql`;
  const parts = [`-- BATCH ${n} of ${batches.length} — run in Supabase SQL Editor`, `-- Project: kdmjipeksjdyojjdokbi`, ""];
  for (const f of files) {
    const path = join(ROOT, "supabase", "migrations", f);
    if (!existsSync(path)) {
      console.warn(`Missing: ${f}`);
      continue;
    }
    parts.push(`-- ── ${f} — ${LABELS[f] ?? ""}`, "");
    parts.push(readFileSync(path, "utf8"));
    parts.push("", "");
  }
  writeFileSync(join(OUT, outName), parts.join("\n"), "utf8");
  const list = files.map((f) => `\`${f}\``).join(", ");
  readme.push(`| ${n} | \`batch-${String(n).padStart(2, "0")}.sql\` | ${list} |`);
  console.log(`Wrote ${outName} (${files.length} migrations)`);
});

// Seed batch (separate — large file)
const seedPath = join(ROOT, "supabase", "seeds", "class12_math_templates.sql");
if (existsSync(seedPath)) {
  const seedOut = join(OUT, "batch-05-seed-class12-math.sql");
  writeFileSync(
    seedOut,
    [
      "-- SEED — Class 12 Math templates (run AFTER batch-04, migration 110)",
      "-- Project: kdmjipeksjdyojjdokbi",
      "",
      readFileSync(seedPath, "utf8"),
    ].join("\n"),
    "utf8",
  );
  readme.push(`| 5 (seed) | \`batch-05-seed-class12-math.sql\` | class12_math_templates (1373 rows) |`);
  console.log("Wrote batch-05-seed-class12-math.sql");
}

readme.push(`
## After all batches

Run in terminal (with DATABASE_URL in .env.local):
\`\`\`
npm run db:check-migrations
\`\`\`

Or verify in SQL Editor:
\`\`\`sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'rpc_student_recovery_zone',
    'rpc_ensure_battle_report',
    'rpc_create_open_battle'
  );
\`\`\`
`);

writeFileSync(join(OUT, "README.md"), readme.join("\n"), "utf8");
console.log(`\nDone → ${OUT}`);
