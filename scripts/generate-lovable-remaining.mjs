/**
 * Build LOVABLE_REMAINING.sql — pending migrations for Lovable DB.
 * Run: npm run db:generate-lovable-remaining
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "supabase", "LOVABLE_REMAINING.sql");

const FILES = [
  "20260607000000_student_success_phase2.sql",
  "20260608000000_student_success_phase3.sql",
  "20260607033426_44e6c2c6-c95e-4dc5-9444-9cf9ce5a4758.sql",
  "20260614000000_unify_practice_analytics.sql",
  "20260615000000_battle_template_fallback.sql",
  "20260616000000_fix_revision_complete.sql",
];

const parts = [
  "-- LOVABLE REMAINING: paste once in SQL Editor",
  "-- Project: kdmjipeksjdyojjdokbi (Lovable)",
  "",
];

for (const f of FILES) {
  parts.push(`-- ========== ${f} ==========`, "");
  parts.push(readFileSync(join(ROOT, "supabase", "migrations", f), "utf8"));
  parts.push("");
}

writeFileSync(OUT, parts.join("\n"), "utf8");
const kb = (Buffer.byteLength(parts.join("\n")) / 1024).toFixed(1);
console.log(`Wrote ${OUT} (${kb} KB)`);
