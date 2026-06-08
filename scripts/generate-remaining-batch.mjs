/**
 * Build SQL batches for ONLY migrations not yet on live DB.
 * Probes via anon REST (same as db:check-migrations), then writes supabase/sql-batches/remaining-*.sql
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "supabase", "sql-batches");
const BATCH_SIZE = 3;

/** Files still needed — updated after live probe 2026-06-04 */
const REMAINING_FILES = [
  "20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql",
  "20260516000000_inquiries_complaints.sql",
  "20260604030000_student_panel_fixes.sql",
  "20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql",
  "20260604080000_battle_monitor.sql",
  "20260604100000_battleground_phase4.sql",
  "20260604120000_demo_data.sql",
  "20260607000000_student_success_phase2.sql",
  "20260608000000_student_success_phase3.sql",
  "20260609000000_fix_quick_battle_overload.sql",
  "20260610000000_battleground_overhaul.sql",
  "20260611000000_question_template_engine.sql",
  "20260612000000_ai_and_audit_fixes.sql",
  "20260613000000_concept_mastery_recovery.sql",
];

const LABELS = Object.fromEntries(
  REMAINING_FILES.map((f) => [f, f.replace(/^\d+_?/, "").replace(".sql", "")]),
);

mkdirSync(OUT, { recursive: true });

// Refresh probe output
spawnSync("node", ["scripts/check-pending-migrations.mjs"], { cwd: ROOT, stdio: "inherit" });

const batches = [];
for (let i = 0; i < REMAINING_FILES.length; i += BATCH_SIZE) {
  batches.push(REMAINING_FILES.slice(i, i + BATCH_SIZE));
}

const readme = [
  "# REMAINING migrations only (live DB probe)",
  "",
  "Already applied: wisdom engine, leaderboard, notifications, app_settings,",
  "battleground feed, battle reports, portal login, student success phase 1.",
  "",
  "Open: https://supabase.com/dashboard/project/kdmjipeksjdyojjdokbi/sql/new",
  "",
  "Run each file below **in order**. Wait for success before the next.",
  "",
  "| Step | File |",
  "|------|------|",
];

batches.forEach((files, idx) => {
  const n = idx + 1;
  const outName = `remaining-${String(n).padStart(2, "0")}.sql`;
  const parts = [
    `-- REMAINING BATCH ${n}/${batches.length} — Supabase SQL Editor`,
    `-- Project: kdmjipeksjdyojjdokbi`,
    `-- NO Lovable credits needed`,
    "",
  ];
  for (const f of files) {
    const path = join(ROOT, "supabase", "migrations", f);
    if (!existsSync(path)) {
      console.warn(`Missing: ${f}`);
      continue;
    }
    parts.push(`-- ── ${f}`, "");
    parts.push(readFileSync(path, "utf8"));
    parts.push("", "");
  }
  writeFileSync(join(OUT, outName), parts.join("\n"), "utf8");
  readme.push(`| ${n} | \`${outName}\` |`);
  console.log(`Wrote ${outName} (${files.length} files)`);
});

const seedPath = join(ROOT, "supabase", "seeds", "class12_math_templates.sql");
if (existsSync(seedPath)) {
  writeFileSync(
    join(OUT, "remaining-seed-class12.sql"),
    ["-- Run AFTER remaining-05 (migration 110)", "", readFileSync(seedPath, "utf8")].join("\n"),
    "utf8",
  );
  readme.push("| seed | `remaining-seed-class12.sql` |");
}

readme.push("", "Or run: `npm run db:paste-next` to copy batch 1 to clipboard + open SQL Editor.");

writeFileSync(join(OUT, "REMAINING-README.md"), readme.join("\n"), "utf8");
console.log(`\n${REMAINING_FILES.length} migrations → ${batches.length} batches in ${OUT}`);
