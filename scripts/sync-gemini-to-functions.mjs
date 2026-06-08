/**
 * Copy shared Gemini client into each AI edge function folder.
 * Lovable deploys functions per-folder — ../_shared imports often fail.
 * Run: npm run functions:sync
 */
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "supabase", "functions", "_shared", "gemini.ts");

const TARGETS = [
  "ai-explain",
  "ai-battle-report",
  "ai-improvement-plan",
  "ai-concept-report",
  "dpp-generate-questions",
];

const src = readFileSync(SRC, "utf8");
for (const fn of TARGETS) {
  const dest = join(ROOT, "supabase", "functions", fn, "gemini.ts");
  writeFileSync(dest, src, "utf8");
  console.log(`synced → ${fn}/gemini.ts`);
}
