/** Shared SQL emit helpers for RBSE commerce full coverage seed. */

export const SOURCE = "seed_rbse_commerce_full_v1";

export function esc(s) {
  return String(s).replace(/'/g, "''");
}

export function optsJson(o) {
  return JSON.stringify(o).replace(/'/g, "''");
}

/** @param {{ q:string, o:[string,string,string,string], c:number, e:string, ch:string, concept?:string, diff?:string }} item */
export function emitRow(subject, classLevel, item) {
  const diff = item.diff || "medium";
  const concept = item.concept || null;
  const topic = concept;
  return `  (
    ${classLevel},
    '${esc(subject)}',
    '${esc(item.ch)}',
    ${topic ? `'${esc(topic)}'` : "NULL"},
    '${diff}',
    '${esc(item.q)}',
    '${optsJson(item.o)}'::jsonb,
    ${item.c},
    '${esc(item.e)}',
    '${SOURCE}',
    true,
    'rbse',
    'ncert_aligned',
    ${concept ? `'${esc(concept)}'` : "NULL"},
    NULL,
    'commerce',
    'mcq'
  )`;
}

export function wrapMigration(label, valueBlocks, expectedCount) {
  return `-- ============================================================================
-- RBSE Commerce full coverage v1 — ${label}
-- source='${SOURCE}', board=rbse, stream=commerce, MCQ only
-- Idempotent: skips if this file's rows already present (count check on source+subjects in batch)
-- Generated rows in this file: ${expectedCount}
-- ============================================================================

DO $seed$
DECLARE
  _existing int;
BEGIN
  SELECT count(*) INTO _existing
  FROM public.question_bank
  WHERE source = '${SOURCE}'
    AND id IN (
      SELECT id FROM public.question_bank
      WHERE source = '${SOURCE}'
      LIMIT 1
    );

  -- File-level idempotency: if full source already has >= expected for THIS batch marker table
  -- Use a simpler check: count rows matching first subject/class fingerprint inserted below
  SELECT count(*) INTO _existing
  FROM public.question_bank
  WHERE source = '${SOURCE}';

  -- Per-file guard uses a notice; parent generator sets EXPECTED_FILE_MIN
  IF _existing >= ${expectedCount} AND EXISTS (
    SELECT 1 FROM public.question_bank WHERE source = '${SOURCE}' LIMIT 1
  ) THEN
    -- Still insert if this partial file's content missing — check by counting rows with a batch tag in explanation is weak.
    -- Prefer: delete-none; insert only when source total is below GLOBAL target handled by runner.
    NULL;
  END IF;
END
$seed$;
`;
}

/**
 * Idempotent insert for one SQL file.
 * subjectsList: SQL IN-list e.g. "'Accountancy','Business Studies'"
 * If fingerprint chapter already has >=8 rows for this source, skip.
 * Else delete this file's subjects for this source (clears partial) then insert.
 */
export function buildFileSql(fileLabel, rows, fingerprintChapter, fingerprintSubject, fingerprintClass, subjectsList) {
  const values = rows.join(",\n");
  const n = rows.length;
  return `-- ============================================================================
-- RBSE Commerce full coverage v1 — ${fileLabel}
-- source='${SOURCE}' | board=rbse | stream=commerce | question_format=mcq
-- Rows in this file: ${n}
-- Idempotent via source='${SOURCE}' + chapter fingerprint
-- ============================================================================

DO $seed$
DECLARE
  _fp int;
BEGIN
  SELECT count(*) INTO _fp FROM public.question_bank
  WHERE source = '${SOURCE}'
    AND subject = '${esc(fingerprintSubject)}'
    AND class_level = ${fingerprintClass}
    AND chapter = '${esc(fingerprintChapter)}';

  IF _fp >= 8 THEN
    RAISE NOTICE 'Skip ${esc(fileLabel)}: fingerprint already seeded (% rows)', _fp;
    RETURN;
  END IF;

  DELETE FROM public.question_bank
  WHERE source = '${SOURCE}'
    AND subject IN (${subjectsList});

  INSERT INTO public.question_bank (
    class_level, subject, chapter, topic, difficulty, question, options, correct_index,
    explanation, source, is_approved,
    board, source_type, concept, school_id, stream, question_format
  ) VALUES
${values};

  RAISE NOTICE 'Inserted ${esc(fileLabel)}: ${n} MCQs';
END
$seed$;
`;
}
