#!/usr/bin/env node
/**
 * Apply the repo's migrations to the LOCAL replica, in filename order.
 *
 * Every file runs in its own psql invocation with ON_ERROR_STOP=1. A failure is
 * recorded and the run continues, so one unsupported migration does not hide
 * the state of the 400 after it. The report is the point: it says exactly which
 * files did not apply and why, and the test-flow probes then run only against a
 * replica whose test-path migrations all applied.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const MIG = path.join(REPO, "supabase/migrations");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TMP = path.join(process.env.TMPDIR || "/tmp", "gurukul-local-replica");
mkdirSync(TMP, { recursive: true });

const DB = process.env.GK_DB || "gurukul";
const PORT = process.env.GK_PORT || "5433";

function psql(args, input) {
  return execFileSync("psql", ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const results = [];
let applied = 0;
let failed = 0;

for (const f of files) {
  const full = path.join(MIG, f);
  let sql = readFileSync(full, "utf8");

  // The only local transformation: pgvector is not installable on this cluster.
  // Migrations that create a `vector` column are rewritten to `real[]`, which
  // is what the repo's own fallback branch does when pgvector is absent
  // ("pgvector unavailable — using embedding_compat real[] only"). Nothing in
  // the test flow touches an embedding; this keeps the question-bank tables
  // creatable so later migrations that reference them still apply.
  const transformed = /vector\s*\(\s*\d+\s*\)/i.test(sql) || /USING (ivfflat|hnsw)/i.test(sql);
  if (transformed) {
    sql = sql
      .replace(/vector\s*\(\s*\d+\s*\)/gi, "real[]")
      .replace(/CREATE\s+(INDEX|UNIQUE INDEX)([\s\S]*?)USING\s+(ivfflat|hnsw)[\s\S]*?;/gi, "-- [local] vector index skipped;")
      .replace(/CREATE EXTENSION IF NOT EXISTS vector[^;]*;/gi, "-- [local] pgvector unavailable;");
  }

  const tmpFile = path.join(TMP, f);
  writeFileSync(tmpFile, sql);

  try {
    psql(["-f", tmpFile]);
    applied++;
    results.push({ file: f, ok: true, transformed });
  } catch (e) {
    failed++;
    const err = (e.stderr || e.stdout || String(e.message)).toString();
    results.push({ file: f, ok: false, transformed, error: err.split("\n").filter(Boolean).slice(0, 6).join(" | ") });
    console.log(`FAIL ${f}\n     ${err.split("\n").filter(Boolean).slice(0, 4).join("\n     ")}`);
  }
}

writeFileSync(path.join(TMP, "apply-report.json"), JSON.stringify({ applied, failed, results }, null, 2));
console.log(`\napplied ${applied} / ${files.length}, failed ${failed}`);
