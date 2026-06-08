/**
 * Full schema for a NEW empty Supabase project.
 * Excludes Lovable duplicate UUID migration fragments.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIG = join(ROOT, "supabase", "migrations");
const OUT = join(ROOT, "supabase", "sql-batches", "fresh");
const BATCH_SIZE = 4;

const SKIP = new Set([
  "20260605020836_303936bd-af31-4eec-ab35-ea5bfa218d76.sql",
  "20260605020942_caa2600b-6a56-4160-8082-76061a292656.sql",
  "20260605021012_d4548514-27d6-4672-8071-0c7450589756.sql",
  "20260605021124_d3dea4be-7879-412e-a009-253499a419b5.sql",
  "20260605021158_51deddcd-c034-45ed-85fd-57a9d1bfacdd.sql",
  "20260607033426_44e6c2c6-c95e-4dc5-9444-9cf9ce5a4758.sql",
]);

const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql") && !SKIP.has(f))
  .sort();

mkdirSync(OUT, { recursive: true });

const batches = [];
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  batches.push(files.slice(i, i + BATCH_SIZE));
}

batches.forEach((group, idx) => {
  const n = idx + 1;
  const name = `fresh-batch-${String(n).padStart(2, "0")}.sql`;
  const parts = [
    `-- FRESH DATABASE batch ${n}/${batches.length}`,
    `-- For NEW empty Supabase project (paste in SQL Editor → Run)`,
    `-- Project: imrsjhftejghcrhzdjrl`,
    "",
  ];
  for (const f of group) {
    parts.push(`-- ── ${f}`, "", readFileSync(join(MIG, f), "utf8"), "", "");
  }
  writeFileSync(join(OUT, name), parts.join("\n"), "utf8");
  console.log(`Wrote ${name} (${group.length} files)`);
});

const seed = join(ROOT, "supabase", "seeds", "class12_math_templates.sql");
if (readFileSync) {
  writeFileSync(
    join(OUT, "fresh-batch-seed-math12.sql"),
    `-- Run LAST after all fresh-batch-*.sql\n\n${readFileSync(seed, "utf8")}`,
    "utf8",
  );
  console.log("Wrote fresh-batch-seed-math12.sql");
}

writeFileSync(
  join(OUT, "START-HERE.txt"),
  `NEW EMPTY SUPABASE — paste in SQL Editor in order:

1. fresh-batch-01.sql
2. fresh-batch-02.sql
... through fresh-batch-${String(batches.length).padStart(2, "0")}.sql
LAST: fresh-batch-seed-math12.sql

Folder: supabase/sql-batches/fresh/
`,
  "utf8",
);

console.log(`\n${files.length} migrations → ${batches.length} batches + seed`);
