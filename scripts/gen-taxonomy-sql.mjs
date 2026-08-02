/**
 * Generate docs/APPLY_ACADEMIC_TAXONOMY_V2.sql (+ matching migration) from taxonomy seed sources.
 * Run: node scripts/gen-taxonomy-sql.mjs
 *
 * Chapter term_ids are subject+class-qualified so repeated titles (Introduction 11/12, etc.)
 * never collide under UNIQUE (kind, term_id) within a single INSERT … ON CONFLICT.
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

/** Prefer human display labels when the same id appears twice. */
function preferDisplay(a, b) {
  const score = (s) => {
    let n = 0;
    if (/\s/.test(s)) n += 4;
    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) n += 2;
    if (!/_/.test(s)) n += 3;
    if (s.length > 12) n += 1;
    return n + Math.min(s.length, 40) / 40;
  };
  return score(b) > score(a) ? b : a;
}

const conceptsMap = new Map();
for (const row of parseTsStringRecord(bank, "BANK_CONCEPT_DISPLAY")) {
  const prev = conceptsMap.get(row.id);
  conceptsMap.set(row.id, prev == null ? row.display : preferDisplay(prev, row.display));
}
for (const row of parseTsStringRecord(dict, "CORE_CONCEPT_DISPLAY")) {
  const prev = conceptsMap.get(row.id);
  conceptsMap.set(row.id, prev == null ? row.display : preferDisplay(prev, row.display));
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

/** Mirrors src/academic/taxonomy/canonicalize.ts chapterTermId */
function chapterTermId(displayName, subjectId, classLevel) {
  const base = slugify(displayName);
  const subject = slugify(subjectId) || "subject";
  return `${base || "chapter"}_${subject}_c${classLevel}`;
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

/**
 * Deduplicate rows by conflict key before INSERT … ON CONFLICT DO UPDATE.
 * Postgres rejects the whole statement if the same constrained values appear twice in one VALUES list.
 */
function dedupeByKey(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    if (preferDisplay(prev.display, row.display) === row.display) {
      map.set(key, { ...prev, ...row, display: row.display });
    }
  }
  return [...map.values()];
}

const lines = [];
lines.push("-- ============================================================================");
lines.push("-- Academic taxonomy v2 — full commerce bank concepts + chapters");
lines.push("-- Companion: src/academic/taxonomy (presentAcademicLabel / formatAcademicLabel)");
lines.push("-- Apply in Supabase SQL editor (idempotent upserts)");
lines.push("-- Chapter term_id = {slug}_{subject}_c{class} so 11/12 title repeats never collide");
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
lines.push("SELECT kind, term_id, display_name, aliases, board");
lines.push("FROM (");
lines.push("  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES");
lines.push(
  subjectRows
    .map(([id, dn, al]) => `    ('subject'::text, ${sqlStr(id)}, ${sqlStr(dn)}, ${sqlJson(al)}, 'rbse'::text)`)
    .join(",\n"),
);
lines.push("  ) AS v(kind, term_id, display_name, aliases, board)");
lines.push("  ORDER BY kind, term_id, length(display_name) DESC");
lines.push(") AS d");
lines.push(
  "ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();",
);
lines.push("");

const chapRows = dedupeByKey(
  chapters.map((c) => ({
    tid: chapterTermId(c.display, c.subjectId, c.classLevel),
    display: c.display,
    subjectId: c.subjectId,
    classLevel: c.classLevel,
    subjectLabel: subjectMap[c.subjectId] || c.subjectId,
  })),
  (r) => r.tid,
);

const chapVals = chapRows.map(
  (c) =>
    `    ('chapter'::text, ${sqlStr(c.tid)}, ${sqlStr(c.display)}, '[]'::jsonb, 'rbse'::text, ${c.classLevel}::int, ${sqlStr(c.subjectLabel)}, ${sqlStr(c.subjectId)})`,
);

lines.push("-- Chapters from live QB (term_id unique per subject+class)");
for (let i = 0; i < chapVals.length; i += 40) {
  const slice = chapVals.slice(i, i + 40);
  lines.push(
    "INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)",
  );
  lines.push("SELECT kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id");
  lines.push("FROM (");
  lines.push("  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES");
  lines.push(slice.join(",\n"));
  lines.push(
    "  ) AS v(kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)",
  );
  lines.push("  ORDER BY kind, term_id, length(display_name) DESC");
  lines.push(") AS d");
  lines.push(`ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();`);
  lines.push("");
}

const conceptRows = dedupeByKey(
  [...conceptsMap.entries()].map(([id, display]) => ({ tid: id, display })),
  (r) => r.tid,
);

const conceptVals = conceptRows.map(({ tid, display }) => {
  const aliases = [display, display.toLowerCase(), tid.replace(/_/g, " ")];
  return `    ('concept'::text, ${sqlStr(tid)}, ${sqlStr(display)}, ${sqlJson(aliases)}, 'rbse'::text)`;
});

lines.push("-- Concepts / topics (bank + curated core)");
for (let i = 0; i < conceptVals.length; i += 40) {
  const slice = conceptVals.slice(i, i + 40);
  lines.push("INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)");
  lines.push("SELECT kind, term_id, display_name, aliases, board");
  lines.push("FROM (");
  lines.push("  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES");
  lines.push(slice.join(",\n"));
  lines.push("  ) AS v(kind, term_id, display_name, aliases, board)");
  lines.push("  ORDER BY kind, term_id, length(display_name) DESC");
  lines.push(") AS d");
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

const sqlBody = lines.join("\n");
const outPath = path.join(root, "docs/APPLY_ACADEMIC_TAXONOMY_V2.sql");
const migPath = path.join(root, "supabase/migrations/20260802280000_academic_taxonomy_terms_v2.sql");
fs.writeFileSync(outPath, sqlBody);
fs.writeFileSync(migPath, sqlBody);
console.log(
  JSON.stringify(
    {
      path: outPath,
      migration: migPath,
      bytes: sqlBody.length,
      concepts: conceptVals.length,
      chapters: chapVals.length,
    },
    null,
    2,
  ),
);
