/**
 * Generate docs/APPLY_ACADEMIC_TAXONOMY_V2.sql from taxonomy seed sources.
 * Run: node scripts/gen-taxonomy-sql.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bank = fs.readFileSync(path.join(root, "src/academic/taxonomy/seeds/bankConcepts.ts"), "utf8");
const commerce = fs.readFileSync(path.join(root, "src/academic/taxonomy/seeds/commerceRbse.ts"), "utf8");
const dict = fs.readFileSync(path.join(root, "src/academic/taxonomy/dictionary.ts"), "utf8");

function parseTsStringRecord(src, exportName) {
  const start = src.indexOf(`export const ${exportName}`);
  if (start < 0) return [];
  const brace = src.indexOf("{", start);
  let depth = 0;
  let end = brace;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(brace + 1, end);
  const out = [];
  const re = /(?:"([^"]+)"|([A-Za-z0-9_]+))\s*:\s*"((?:\\.|[^"])*)"/g;
  let m;
  while ((m = re.exec(body))) {
    out.push({ id: m[1] || m[2], display: JSON.parse(`"${m[3]}"`) });
  }
  return out;
}

const conceptsMap = new Map();
for (const row of parseTsStringRecord(bank, "BANK_CONCEPT_DISPLAY")) {
  conceptsMap.set(row.id, row.display);
}
// Core curated entries from dictionary CORE block (best-effort: CONCEPT after merge isn't parseable)
// Re-parse CORE_CONCEPT_DISPLAY if present
for (const row of parseTsStringRecord(dict, "CORE_CONCEPT_DISPLAY")) {
  conceptsMap.set(row.id, row.display);
}

const chapters = [];
const chapRe = /chapter\(\s*"((?:\\.|[^"])*)"\s*,\s*"([^"]+)"\s*,\s*(\d+)/g;
let cm;
while ((cm = chapRe.exec(commerce))) {
  chapters.push({
    display: JSON.parse(`"${cm[1]}"`),
    subjectId: cm[2],
    classLevel: +cm[3],
  });
}

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
function sqlJson(arr) {
  return `${sqlStr(JSON.stringify(arr))}::jsonb`;
}

const subjectMap = {
  accountancy: "Accountancy",
  business_studies: "Business Studies",
  economics: "Economics",
  mathematics: "Mathematics",
  english: "English",
  hindi: "Hindi",
};

const subjectRows = [
  ["accountancy", "Accountancy", ["accounts", "accounting"]],
  ["business_studies", "Business Studies", ["bst"]],
  ["economics", "Economics", ["eco"]],
  ["mathematics", "Mathematics", ["maths", "math"]],
  ["english", "English", []],
  ["hindi", "Hindi", []],
  ["physics", "Physics", []],
  ["chemistry", "Chemistry", []],
  ["biology", "Biology", []],
  ["computer_science", "Computer Science", ["cs"]],
  ["informatics_practices", "Informatics Practices", ["ip"]],
  ["social_science", "Social Science", ["sst", "social studies"]],
];

const lines = [];
lines.push("-- ============================================================================");
lines.push("-- Academic taxonomy v2 — full commerce bank concepts + chapters");
lines.push("-- Companion: src/academic/taxonomy (presentAcademicLabel / formatAcademicLabel)");
lines.push("-- Apply in Supabase SQL editor (idempotent upserts)");
lines.push("-- ============================================================================");
lines.push("");
lines.push("CREATE TABLE IF NOT EXISTS public.academic_taxonomy_terms (");
lines.push("  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),");
lines.push(
  "  kind text NOT NULL CHECK (kind IN ('board','class_level','subject','chapter','topic','concept','question_type')),",
);
lines.push("  term_id text NOT NULL,");
lines.push("  display_name text NOT NULL,");
lines.push("  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,");
lines.push("  board text NULL,");
lines.push("  class_level int NULL,");
lines.push("  subject text NULL,");
lines.push("  parent_term_id text NULL,");
lines.push("  description text NULL,");
lines.push("  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,");
lines.push("  created_at timestamptz NOT NULL DEFAULT now(),");
lines.push("  updated_at timestamptz NOT NULL DEFAULT now(),");
lines.push("  UNIQUE (kind, term_id)");
lines.push(");");
lines.push("");
lines.push("CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_kind_idx");
lines.push("  ON public.academic_taxonomy_terms (kind);");
lines.push("CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_subject_idx");
lines.push("  ON public.academic_taxonomy_terms (subject) WHERE subject IS NOT NULL;");
lines.push("");
lines.push("ALTER TABLE public.academic_taxonomy_terms ENABLE ROW LEVEL SECURITY;");
lines.push("");
lines.push("DROP POLICY IF EXISTS academic_taxonomy_terms_select_authenticated ON public.academic_taxonomy_terms;");
lines.push("CREATE POLICY academic_taxonomy_terms_select_authenticated");
lines.push("  ON public.academic_taxonomy_terms FOR SELECT TO authenticated USING (true);");
lines.push("");
lines.push("DROP POLICY IF EXISTS academic_taxonomy_terms_write_operators ON public.academic_taxonomy_terms;");
lines.push("CREATE POLICY academic_taxonomy_terms_write_operators");
lines.push("  ON public.academic_taxonomy_terms FOR ALL TO authenticated");
lines.push("  USING (");
lines.push("    public.has_role(auth.uid(), 'admin')");
lines.push("    OR public.has_role(auth.uid(), 'principal')");
lines.push("    OR public.has_role(auth.uid(), 'teacher')");
lines.push("  )");
lines.push("  WITH CHECK (");
lines.push("    public.has_role(auth.uid(), 'admin')");
lines.push("    OR public.has_role(auth.uid(), 'principal')");
lines.push("    OR public.has_role(auth.uid(), 'teacher')");
lines.push("  );");
lines.push("");

lines.push("-- Subjects");
lines.push("INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)");
lines.push("VALUES");
lines.push(
  subjectRows
    .map(([id, dn, al]) => `  ('subject', ${sqlStr(id)}, ${sqlStr(dn)}, ${sqlJson(al)}, 'rbse')`)
    .join(",\n"),
);
lines.push(
  "ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();",
);
lines.push("");

const chapVals = chapters.map((c) => {
  const tid = slugify(c.display);
  const subj = subjectMap[c.subjectId] || c.subjectId;
  return `  ('chapter', ${sqlStr(tid)}, ${sqlStr(c.display)}, '[]'::jsonb, 'rbse', ${c.classLevel}, ${sqlStr(subj)}, ${sqlStr(c.subjectId)})`;
});

lines.push("-- Chapters from live QB");
for (let i = 0; i < chapVals.length; i += 40) {
  const slice = chapVals.slice(i, i + 40);
  lines.push(
    "INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)",
  );
  lines.push("VALUES");
  lines.push(slice.join(",\n"));
  lines.push(`ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();`);
  lines.push("");
}

const conceptVals = [...conceptsMap.entries()].map(([id, display]) => {
  const aliases = [display, display.toLowerCase(), id.replace(/_/g, " ")];
  return `  ('concept', ${sqlStr(id)}, ${sqlStr(display)}, ${sqlJson(aliases)}, 'rbse')`;
});

lines.push("-- Concepts / topics (bank + curated core)");
for (let i = 0; i < conceptVals.length; i += 40) {
  const slice = conceptVals.slice(i, i + 40);
  lines.push("INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)");
  lines.push("VALUES");
  lines.push(slice.join(",\n"));
  lines.push(
    "ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();",
  );
  lines.push("");
}

lines.push(`-- Normalize chapter display text (mojibake / unicode dashes)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_fix_academic_display_text'
  ) THEN
    UPDATE public.question_bank
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL
      AND (chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]');
  ELSE
    UPDATE public.question_bank
    SET chapter = trim(both from regexp_replace(
      regexp_replace(chapter, '[‐‑‒–—―−]', '-', 'g'),
      '\\s+', ' ', 'g'))
    WHERE chapter IS NOT NULL AND chapter ~ '[‐‑‒–—―−]';
  END IF;
END $$;
`);

lines.push(`-- Slugify topic/concept when they match taxonomy term ids
UPDATE public.question_bank qb
SET concept = lower(regexp_replace(regexp_replace(btrim(qb.concept), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE qb.concept IS NOT NULL
  AND qb.concept ~ '[A-Z ]'
  AND length(btrim(qb.concept)) BETWEEN 2 AND 80
  AND EXISTS (
    SELECT 1 FROM public.academic_taxonomy_terms t
    WHERE t.kind = 'concept'
      AND (
        t.term_id = lower(regexp_replace(regexp_replace(btrim(qb.concept), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
        OR lower(t.display_name) = lower(btrim(qb.concept))
      )
  );

UPDATE public.question_bank qb
SET topic = lower(regexp_replace(regexp_replace(btrim(qb.topic), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE qb.topic IS NOT NULL
  AND qb.topic ~ '[A-Z ]'
  AND length(btrim(qb.topic)) BETWEEN 2 AND 80
  AND EXISTS (
    SELECT 1 FROM public.academic_taxonomy_terms t
    WHERE t.kind IN ('concept', 'topic')
      AND (
        t.term_id = lower(regexp_replace(regexp_replace(btrim(qb.topic), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
        OR lower(t.display_name) = lower(btrim(qb.topic))
      )
  );
`);

const outPath = path.join(root, "docs/APPLY_ACADEMIC_TAXONOMY_V2.sql");
fs.writeFileSync(outPath, lines.join("\n"));
console.log(
  JSON.stringify(
    {
      path: outPath,
      bytes: lines.join("\n").length,
      concepts: conceptVals.length,
      chapters: chapVals.length,
    },
    null,
    2,
  ),
);
