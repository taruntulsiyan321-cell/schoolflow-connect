/** Split class12_math_templates.sql into paste-friendly batches for Supabase SQL Editor */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "supabase", "seeds", "class12_math_templates.sql");
const OUT = join(ROOT, "supabase", "sql-batches", "seed-math12");
const PER_BATCH = 150;

const lines = readFileSync(SRC, "utf8").split(/\r?\n/);
const header = lines.filter((l) => l.startsWith("DELETE") || l.startsWith("--"));
const inserts = lines.filter((l) => l.startsWith("INSERT"));

mkdirSync(OUT, { recursive: true });

const batches = [];
for (let i = 0; i < inserts.length; i += PER_BATCH) {
  batches.push(inserts.slice(i, i + PER_BATCH));
}

batches.forEach((chunk, idx) => {
  const n = idx + 1;
  const name = `seed-math12-${String(n).padStart(2, "0")}.sql`;
  const parts = [
    `-- Math12 seed batch ${n}/${batches.length} (${chunk.length} rows)`,
    `-- Project: imrsjhftejghcrhzdjrl`,
    "",
  ];
  if (n === 1) parts.push(...header, "");
  parts.push(...chunk, "");
  writeFileSync(join(OUT, name), parts.join("\n"), "utf8");
  console.log(`Wrote ${name}`);
});

writeFileSync(
  join(OUT, "README.txt"),
  `Run in SQL Editor in order: seed-math12-01.sql through seed-math12-${String(batches.length).padStart(2, "0")}.sql\nThen verify: SELECT count(*) FROM question_templates;\n`,
  "utf8",
);
console.log(`\n${inserts.length} inserts → ${batches.length} batches in ${OUT}`);
