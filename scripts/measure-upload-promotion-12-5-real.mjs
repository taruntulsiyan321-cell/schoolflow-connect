/**
 * §12.5 real promotion — one pass into question_bank + four gate negatives.
 *
 *   node scripts/measure-upload-promotion-12-5-real.mjs
 *
 * Extends the plumbing probe: calls store_generated_questions (service path
 * via Management API as postgres) with upload provenance. Every write is
 * rolled back. Exit 0 only when all five cases match; exit 2 if no token.
 *
 * Gates (§10.2):
 *   1. real chapter_id
 *   2. valid MCQ variant (options + correct_index + explanation)
 *   3. not near-duplicate (caller boolean — simulated by skipping store when true)
 *   4. source answer_source != 'ai'
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(name) {
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
loadEnv(".env.local");
loadEnv(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("BLOCKED: no SUPABASE_ACCESS_TOKEN — not a §12.5 pass.");
  process.exit(2);
}

async function runSql(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

console.log("§12.5 real — promotion into question_bank (+ 4 negatives)\n");

// Pure gates first (positive control on the runner).
let vitestCli;
try {
  vitestCli = require.resolve("vitest/vitest.mjs");
} catch {
  vitestCli = require.resolve("vitest/dist/cli.js");
}
const vitest = spawnSync(
  process.execPath,
  [vitestCli, "run", "src/academic/services/uploadPromotionGates.test.ts"],
  { cwd: ROOT, encoding: "utf8", env: process.env },
);
if (vitest.status !== 0 || !/5 passed/.test(vitest.stdout || "")) {
  console.error(vitest.stdout || vitest.stderr || "");
  console.error("FAIL: canPromote unit tests");
  process.exit(1);
}
console.log("0. canPromote — PASS (5 tests)\n");

const PROBE = `
BEGIN;
SET LOCAL statement_timeout = '90s';

CREATE TEMP TABLE probe(
  n serial, claim text, expected text, observed text, verdict text
) ON COMMIT DROP;

DO $probe$
DECLARE
  _owner uuid;
  _school uuid;
  _chapter uuid;
  _topic uuid;
  _upload uuid;
  _uq_ok uuid;
  _uq_ai uuid;
  _uq_noch uuid;
  _stored jsonb;
  _bank_id uuid;
  _n int;
  _body text;
  _diff text;
BEGIN
  -- Dispatch must accept upload jobs (KI74 / migration 760).
  _body := pg_get_functiondef('public.dispatch_variant_generation()'::regprocedure);
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'dispatch_variant_generation sends source_upload_question_id',
    'num_nonnulls + upload key present',
    CASE
      WHEN position('num_nonnulls' IN _body) > 0
           AND position('source_upload_question_id' IN _body) > 0
        THEN 'present'
      ELSE 'MISSING upload dispatch'
    END,
    CASE
      WHEN position('num_nonnulls' IN _body) > 0
           AND position('source_upload_question_id' IN _body) > 0
        THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  SELECT u.id INTO _owner
    FROM auth.users u
   WHERE EXISTS (
     SELECT 1 FROM public.memberships m
      WHERE m.account_id = u.id AND m.status = 'active'
   )
   ORDER BY u.created_at LIMIT 1;
  SELECT m.school_id INTO _school
    FROM public.memberships m
   WHERE m.account_id = _owner AND m.status = 'active' LIMIT 1;
  SELECT t.id, t.chapter_id INTO _topic, _chapter
    FROM public.topics t
   WHERE t.chapter_id IS NOT NULL
   LIMIT 1;
  SELECT qb.difficulty INTO _diff
    FROM public.question_bank qb
   WHERE qb.difficulty IS NOT NULL
   LIMIT 1;

  IF _owner IS NULL OR _school IS NULL OR _topic IS NULL OR _diff IS NULL THEN
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'fixture: owner + school + topic + difficulty', 'found',
      format('owner=%s school=%s topic=%s diff=%s', _owner, _school, _topic, _diff), 'FAIL');
    RETURN;
  END IF;

  INSERT INTO public.student_uploads (
    owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status
  ) VALUES (
    _owner, _school,
    'measure-12-5-real/' || gen_random_uuid()::text || '.pdf',
    'measure-12-5-real.pdf', 1024, 'application/pdf', 'ready'
  ) RETURNING id INTO _upload;

  -- Source that clears §10.2.1 and §10.2.4
  INSERT INTO public.student_upload_questions (
    upload_id, owner_id, school_id, sequence, question_text,
    options, correct_index, answer_source, explanation, chapter_id, topic_id
  ) VALUES (
    _upload, _owner, _school, 1,
    '[12.5+] What is 3+5?',
    '["6","7","8","9"]'::jsonb, 2, 'file',
    '3+5=8.', _chapter, _topic
  ) RETURNING id INTO _uq_ok;

  -- AI-answered source (§10.2.4 fail)
  INSERT INTO public.student_upload_questions (
    upload_id, owner_id, school_id, sequence, question_text,
    options, correct_index, answer_source, explanation, chapter_id, topic_id
  ) VALUES (
    _upload, _owner, _school, 2,
    '[12.5 ai] What is 1+1?',
    '["1","2","3","4"]'::jsonb, 1, 'ai',
    'AI said 2.', _chapter, _topic
  ) RETURNING id INTO _uq_ai;

  -- No chapter (§10.2.1 fail)
  INSERT INTO public.student_upload_questions (
    upload_id, owner_id, school_id, sequence, question_text,
    options, correct_index, answer_source, explanation, chapter_id, topic_id
  ) VALUES (
    _upload, _owner, _school, 3,
    '[12.5 noch] What is 9-1?',
    '["6","7","8","9"]'::jsonb, 2, 'file',
    '9-1=8.', NULL, _topic
  ) RETURNING id INTO _uq_noch;

  -- POSITIVE: all four gates → bank row with upload provenance
  _stored := public.store_generated_questions(jsonb_build_array(jsonb_build_object(
    'source_upload_question_id', _uq_ok,
    'variant_tier', 1,
    'question', '[12.5+] What is 4+4? (promoted variant)',
    'question_format', 'mcq',
    'options', '["6","7","8","9"]'::jsonb,
    'correct_index', 2,
    'explanation', '4+4=8 — same method, different values.',
    'difficulty', _diff,
    'source', 'ai_recovery_variant',
    'topic_id', _topic
  )));
  _bank_id := NULLIF(_stored->'inserted'->0->>'id', '')::uuid;
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    '§12.5 positive: variant clears all gates into question_bank',
    'inserted>=1 + source_upload_question_id set + source_question_id null',
    coalesce(_stored::text, 'null'),
    CASE
      WHEN _bank_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.question_bank qb
              WHERE qb.id = _bank_id
                AND qb.source_upload_question_id = _uq_ok
                AND qb.source_question_id IS NULL
                AND qb.is_active)
        THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  -- NEGATIVE 1: no chapter on source
  _stored := public.store_generated_questions(jsonb_build_array(jsonb_build_object(
    'source_upload_question_id', _uq_noch,
    'variant_tier', 1,
    'question', '[12.5-] nochapter variant ' || gen_random_uuid()::text,
    'question_format', 'mcq',
    'options', '["1","2","3","4"]'::jsonb,
    'correct_index', 0,
    'explanation', 'Should not promote without chapter.',
    'difficulty', _diff,
    'source', 'ai_recovery_variant',
    'topic_id', _topic
  )));
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    '§12.5 negative: gate §10.2.1 (no chapter) stays private',
    'inserted_count=0 + skip reason chapter',
    coalesce(_stored::text, 'null'),
    CASE
      WHEN coalesce((_stored->>'inserted_count')::int, 0) = 0
           AND (_stored->'skipped'->0->>'reason') ILIKE '%chapter%'
        THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  -- NEGATIVE 2: invalid variant (correct_index out of range) — §10.2.2
  _stored := public.store_generated_questions(jsonb_build_array(jsonb_build_object(
    'source_upload_question_id', _uq_ok,
    'variant_tier', 1,
    'question', '[12.5-] bad variant ' || gen_random_uuid()::text,
    'question_format', 'mcq',
    'options', '["1","2","3","4"]'::jsonb,
    'correct_index', 99,
    'explanation', 'Index is out of range on purpose.',
    'difficulty', _diff,
    'source', 'ai_recovery_variant',
    'topic_id', _topic
  )));
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    '§12.5 negative: gate §10.2.2 (invalid variant) stays private',
    'inserted_count=0',
    coalesce(_stored::text, 'null'),
    CASE
      WHEN coalesce((_stored->>'inserted_count')::int, 0) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  -- NEGATIVE 3: near-duplicate — store is not the home; canPromote says no.
  -- Prove the pure gate refuses when isNearDup=true (already in vitest).
  -- Here: simulate caller skipping store — assert zero new bank rows for a
  -- stem that already exists as the positive insert's question text would.
  -- Behavioural: attempt store of an identical question text to an existing
  -- bank row for this topic; door should skip as duplicate if it checks.
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE source_upload_question_id = _uq_ok;
  _stored := public.store_generated_questions(jsonb_build_array(jsonb_build_object(
    'source_upload_question_id', _uq_ok,
    'variant_tier', 1,
    'question', (SELECT question FROM public.question_bank WHERE id = _bank_id),
    'question_format', 'mcq',
    'options', '["6","7","8","9"]'::jsonb,
    'correct_index', 2,
    'explanation', 'Duplicate of the positive control.',
    'difficulty', _diff,
    'source', 'ai_recovery_variant',
    'topic_id', _topic
  )));
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    '§12.5 negative: gate §10.2.3 (near-dup / duplicate) stays private',
    'inserted_count=0 OR skipped as duplicate',
    coalesce(_stored::text, 'null'),
    CASE
      WHEN coalesce((_stored->>'inserted_count')::int, 0) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  -- NEGATIVE 4: AI-answered source — §10.2.4
  _stored := public.store_generated_questions(jsonb_build_array(jsonb_build_object(
    'source_upload_question_id', _uq_ai,
    'variant_tier', 1,
    'question', '[12.5-] ai source variant ' || gen_random_uuid()::text,
    'question_format', 'mcq',
    'options', '["1","2","3","4"]'::jsonb,
    'correct_index', 1,
    'explanation', 'Should never promote AI-answered sources.',
    'difficulty', _diff,
    'source', 'ai_recovery_variant',
    'topic_id', _topic
  )));
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    '§12.5 negative: gate §10.2.4 (AI-answered source) stays private',
    'inserted_count=0 + skip reason AI',
    coalesce(_stored::text, 'null'),
    CASE
      WHEN coalesce((_stored->>'inserted_count')::int, 0) = 0
           AND (_stored->'skipped'->0->>'reason') ILIKE '%AI%'
        THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  -- Provenance recorded (§10.4) — positive control already checked above;
  -- also assert source_question_id stayed null on that row.
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    '§10.4 provenance: source_upload set, source_question null',
    'upload FK only',
    (SELECT format('up=%s bank_src=%s',
        source_upload_question_id, source_question_id)
       FROM public.question_bank WHERE id = _bank_id),
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.question_bank
         WHERE id = _bank_id
           AND source_upload_question_id = _uq_ok
           AND source_question_id IS NULL)
        THEN 'PASS'
      ELSE 'FAIL'
    END
  );
END $probe$;

SELECT n, claim, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
`;

console.log("1. Live store_generated_questions probe…");
let rows;
try {
  rows = await runSql(PROBE);
} catch (e) {
  console.error(`COULD NOT RUN: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("FAIL: probe returned no rows");
  process.exit(1);
}

let fail = 0;
for (const row of rows) {
  const mark = row.verdict === "PASS" ? "PASS" : "FAIL";
  if (mark !== "PASS") fail += 1;
  console.log(`   [${mark}] ${row.claim}`);
  console.log(`          observed: ${String(row.observed).slice(0, 220)}`);
}

console.log("");
if (fail > 0) {
  console.error(`§12.5 FAIL — ${fail} of ${rows.length} claims failed`);
  process.exit(1);
}
console.log(`§12.5 PASS — ${rows.length} claims (1 positive + 4 negatives + dispatch + provenance)`);
process.exit(0);
