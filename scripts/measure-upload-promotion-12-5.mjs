/**
 * Measure docs/custom-practice-upload-spec.md §12.5 (promotion gates plumbing).
 *
 *   node scripts/measure-upload-promotion-12-5.mjs
 *
 * What §12.5 asks for end-to-end is one variant that clears all four gates into
 * the bank and four negatives. The pure canPromote gates are already covered by
 * vitest (uploadPromotionGates.test.ts). This script measures the DB half that
 * those unit tests cannot see:
 *
 *   1. rpc_enqueue_upload_variant_generation exists (and authenticated may run it)
 *   2. Owner fence — second account cannot enqueue the owner's private question
 *      (paired with owner success as positive control)
 *   3. XOR on variant_generation_queue — exactly one of source_question_id /
 *      source_upload_question_id (neither and both refused; each alone admitted)
 *
 * Every write runs inside one transaction that ROLLs BACK. Exit 0 only when
 * every claim PASSes; exit 2 if credentials are missing (not a pass).
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error(
    "\nBLOCKED: no SUPABASE_ACCESS_TOKEN.\n" +
      "Nothing was asked of the database — this is NOT a §12.5 pass.\n",
  );
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

// ── 0. Pure canPromote gates (already unit-tested) ──────────────────────────
console.log("§12.5 measure — custom-practice-upload-spec promotion gates\n");
console.log("0. canPromote pure gates (vitest)…");
// Resolve vitest's CLI entry directly — avoids npx + shell:true, which on
// Windows leaves a closing handle and trips a libuv assertion after exit 0.
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
if (vitest.status !== 0) {
  console.error(vitest.stdout || "");
  console.error(vitest.stderr || "");
  console.error("FAIL: canPromote unit tests did not pass");
  process.exitCode = 1;
  process.exit();
}
const vitestOk = /5 passed/.test(vitest.stdout || "");
if (!vitestOk) {
  console.error(vitest.stdout || "");
  console.error("FAIL: expected 5 canPromote tests to pass (positive control on the runner)");
  process.exitCode = 1;
  process.exit();
}
console.log("   PASS — 5 canPromote tests (1 positive + 4 gate negatives)\n");

// ── 1–3. Live DB probe ──────────────────────────────────────────────────────
const PROBE_SQL = `
BEGIN;
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE probe(
  n serial,
  claim text,
  expected text,
  observed text,
  verdict text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role', 'postgres', true);
    RETURN 'OK: ' || coalesce(_out, 'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', 'postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;

DO $probe$
DECLARE
  _rpc_ok boolean;
  _exec_auth boolean;
  _exec_anon boolean;
  _check text;
  _owner uuid;
  _other uuid;
  _school uuid;
  _chapter uuid;
  _bank uuid;
  _upload uuid;
  _uq uuid;
  _r text;
  _job uuid;
  _n int;
BEGIN
  -- 1a. RPC exists
  _rpc_ok := to_regprocedure(
    'public.rpc_enqueue_upload_variant_generation(uuid, smallint)'
  ) IS NOT NULL;
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'rpc_enqueue_upload_variant_generation(uuid, smallint) exists',
    'present',
    CASE WHEN _rpc_ok THEN 'present' ELSE 'MISSING' END,
    CASE WHEN _rpc_ok THEN 'PASS' ELSE 'FAIL' END
  );
  IF NOT _rpc_ok THEN
    RETURN;
  END IF;

  _exec_auth := has_function_privilege(
    'authenticated',
    'public.rpc_enqueue_upload_variant_generation(uuid, smallint)',
    'EXECUTE');
  _exec_anon := has_function_privilege(
    'anon',
    'public.rpc_enqueue_upload_variant_generation(uuid, smallint)',
    'EXECUTE');
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'authenticated EXECUTE; anon revoked',
    'auth=true anon=false',
    format('auth=%s anon=%s', _exec_auth, _exec_anon),
    CASE WHEN _exec_auth AND NOT _exec_anon THEN 'PASS' ELSE 'FAIL' END
  );

  -- 3. XOR CHECK present and behavioural
  SELECT pg_get_constraintdef(oid) INTO _check
    FROM pg_constraint
   WHERE conname = 'variant_generation_queue_one_source';
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'variant_generation_queue_one_source CHECK (num_nonnulls = 1)',
    'contains num_nonnulls',
    coalesce(_check, 'MISSING'),
    CASE WHEN _check ILIKE '%num_nonnulls%' THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT id INTO _bank FROM public.question_bank LIMIT 1;
  IF _bank IS NULL THEN
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'fixture: question_bank row for XOR positive control',
      'found', 'NOT FOUND', 'FAIL'
    );
    RETURN;
  END IF;

  -- neither → must refuse
  BEGIN
    INSERT INTO public.variant_generation_queue (
      source_question_id, source_upload_question_id, tier, status
    ) VALUES (NULL, NULL, 1, 'done');
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'XOR: neither source set', 'check_violation', 'ADMITTED', 'FAIL'
    );
  EXCEPTION WHEN check_violation THEN
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'XOR: neither source set', 'check_violation', 'check_violation', 'PASS'
    );
  END;

  -- bank-only → must admit
  INSERT INTO public.variant_generation_queue (source_question_id, tier, status)
  VALUES (_bank, 1, 'done')
  RETURNING id INTO _job;
  DELETE FROM public.variant_generation_queue WHERE id = _job;
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'XOR: bank source alone', 'admitted then cleaned', 'admitted', 'PASS'
  );

  -- Fixtures for upload-only / both / owner fence
  SELECT u.id INTO _owner
    FROM auth.users u
   WHERE EXISTS (
     SELECT 1 FROM public.memberships m
      WHERE m.account_id = u.id AND m.status = 'active'
   )
   ORDER BY u.created_at
   LIMIT 1;
  SELECT u.id INTO _other
    FROM auth.users u
   WHERE u.id <> _owner
     AND EXISTS (
       SELECT 1 FROM public.memberships m
        WHERE m.account_id = u.id AND m.status = 'active'
     )
   ORDER BY u.created_at
   LIMIT 1;

  IF _owner IS NULL OR _other IS NULL THEN
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'fixture: two distinct membership-holding accounts',
      'owner + other',
      format('owner=%s other=%s', coalesce(_owner::text,'null'), coalesce(_other::text,'null')),
      'FAIL'
    );
    RETURN;
  END IF;

  SELECT m.school_id INTO _school
    FROM public.memberships m
   WHERE m.account_id = _owner AND m.status = 'active'
   LIMIT 1;
  SELECT id INTO _chapter FROM public.chapters LIMIT 1;
  IF _school IS NULL OR _chapter IS NULL THEN
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'fixture: owner school_id + any chapter',
      'found',
      format('school=%s chapter=%s', coalesce(_school::text,'null'), coalesce(_chapter::text,'null')),
      'FAIL'
    );
    RETURN;
  END IF;

  INSERT INTO public.student_uploads (
    owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status
  ) VALUES (
    _owner, _school,
    'measure-12-5/' || _owner::text || '/' || gen_random_uuid()::text || '.pdf',
    'measure-12-5.pdf', 1024, 'application/pdf', 'ready'
  ) RETURNING id INTO _upload;

  INSERT INTO public.student_upload_questions (
    upload_id, owner_id, school_id, sequence, question_text,
    options, correct_index, answer_source, explanation, chapter_id
  ) VALUES (
    _upload, _owner, _school, 1,
    '[measure-12-5] What is 2+2?',
    '["3","4","5","6"]'::jsonb, 1, 'file',
    'Because 2+2=4.', _chapter
  ) RETURNING id INTO _uq;

  -- upload-only → must admit
  INSERT INTO public.variant_generation_queue (
    source_upload_question_id, tier, status
  ) VALUES (_uq, 1, 'done')
  RETURNING id INTO _job;
  DELETE FROM public.variant_generation_queue WHERE id = _job;
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'XOR: upload source alone', 'admitted then cleaned', 'admitted', 'PASS'
  );

  -- both → must refuse
  BEGIN
    INSERT INTO public.variant_generation_queue (
      source_question_id, source_upload_question_id, tier, status
    ) VALUES (_bank, _uq, 1, 'done');
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'XOR: both sources set', 'check_violation', 'ADMITTED', 'FAIL'
    );
  EXCEPTION WHEN check_violation THEN
    INSERT INTO probe(claim, expected, observed, verdict) VALUES (
      'XOR: both sources set', 'check_violation', 'check_violation', 'PASS'
    );
  END;

  -- 2. Owner fence: owner enqueues (positive), other cannot (denial)
  _r := pg_temp.as_user(
    _owner,
    format(
      'SELECT public.rpc_enqueue_upload_variant_generation(%L::uuid, 1::smallint)::text',
      _uq
    )
  );
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'owner enqueues upload variant job (positive control)',
    'OK: <uuid>',
    _r,
    CASE
      WHEN _r LIKE 'OK: %' AND _r !~* 'ERROR'
           AND (_r ~* 'OK: [0-9a-f-]{36}' OR _r = 'OK: null')
        THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  SELECT count(*) INTO _n
    FROM public.variant_generation_queue
   WHERE source_upload_question_id = _uq AND status = 'pending';
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'owner enqueue left a pending upload-sourced row (or null skip)',
    'pending>=1 OR OK:null from already-promoted',
    format('pending=%s result=%s', _n, _r),
    CASE
      WHEN _n >= 1 THEN 'PASS'
      WHEN _r = 'OK: null' THEN 'PASS'
      ELSE 'FAIL'
    END
  );

  _r := pg_temp.as_user(
    _other,
    format(
      'SELECT public.rpc_enqueue_upload_variant_generation(%L::uuid, 1::smallint)::text',
      _uq
    )
  );
  INSERT INTO probe(claim, expected, observed, verdict) VALUES (
    'second account cannot enqueue owner''s upload question',
    'ERROR: …not found or not yours',
    _r,
    CASE
      WHEN _r ILIKE 'ERROR:%not found or not yours%' THEN 'PASS'
      ELSE 'FAIL'
    END
  );
END $probe$;

SELECT n, claim, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
`;

console.log("1–3. Live DB probe (RPC / owner fence / XOR)…");
let rows;
try {
  rows = await runSql(PROBE_SQL);
} catch (e) {
  console.error(`COULD NOT RUN: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(rows) || rows.length === 0) {
  console.error("FAIL: probe returned no rows — asserted nothing");
  process.exit(1);
}

let fail = 0;
for (const row of rows) {
  const mark = row.verdict === "PASS" ? "PASS" : "FAIL";
  if (mark !== "PASS") fail += 1;
  console.log(`   [${mark}] ${row.claim}`);
  console.log(`          expected: ${row.expected}`);
  console.log(`          observed: ${String(row.observed).slice(0, 200)}`);
}

console.log("");
if (fail > 0) {
  console.error(`§12.5 FAIL — ${fail} of ${rows.length} live claims failed (+ canPromote unit tests had passed)`);
  process.exitCode = 1;
} else {
  console.log(`§12.5 PASS — canPromote unit tests + ${rows.length} live claims`);
  process.exitCode = 0;
}
