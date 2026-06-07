/**
 * Seed Class 12 Mathematics question templates to Supabase.
 * Run: npm run seed:math12
 *
 * Requires DATABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "kdmjipeksjdyojjdokbi";

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

async function main() {
  const { buildClass12MathCatalog } = await import("./math12Catalog.mjs");
  const catalog = buildClass12MathCatalog();
  const byChapter = {};
  for (const r of catalog) byChapter[r.chapter] = (byChapter[r.chapter] ?? 0) + 1;
  const stats = { total: catalog.length, byChapter };
  console.log("Catalog:", stats);

  const seedsDir = join(ROOT, "supabase", "seeds");
  mkdirSync(seedsDir, { recursive: true });
  const sqlPath = join(seedsDir, "class12_math_templates.sql");
  const chunks = [];
  chunks.push("-- Class 12 Mathematics template seed (idempotent)\n");
  chunks.push("DELETE FROM public.question_templates WHERE class = 12 AND subject = 'Mathematics';\n");

  for (const row of catalog) {
    const td = JSON.stringify(row.template_data).replace(/'/g, "''");
    const et = row.explanation_template.replace(/'/g, "''");
    const ch = row.chapter.replace(/'/g, "''");
    chunks.push(
      `INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', '${ch}', '${row.template_type}', '${td}'::jsonb, '${et}');\n`,
    );
  }

  writeFileSync(sqlPath, chunks.join(""));
  console.log(`Wrote ${catalog.length} templates to ${sqlPath}`);

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;
  const sql = readFileSync(sqlPath, "utf8");

  if (token) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
    console.log("Seeded via Management API.");
    return;
  }

  if (dbUrl) {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
    console.log("Seeded via DATABASE_URL.");
    return;
  }

  console.log("No credentials — SQL file written only. Apply class12_math_templates.sql manually or add DATABASE_URL.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
