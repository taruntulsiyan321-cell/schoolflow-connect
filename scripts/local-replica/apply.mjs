#!/usr/bin/env node
/**
 * Build the LOCAL replica: recreate the database, lay down the Supabase
 * prelude, then apply the repo's migrations in filename order.
 *
 * Every migration runs on its OWN connection. A failure is recorded and the run
 * continues, so one unsupported migration does not hide the state of the 400
 * after it. The report is the point: it says exactly which files did not apply
 * and why, and the flow probes then run only against a replica whose
 * feature-path migrations all applied.
 *
 * WHY THE `pg` CLIENT AND NOT `psql`
 *   This used to shell out to `psql -f` per file, which tied the replica to a
 *   machine that has the PostgreSQL client installed and a Linux `/tmp`. The
 *   flow driver already talks to the database through `pg`, so the harness now
 *   needs one thing — a reachable server — instead of two.
 *
 *   psql's semantics are reproduced, not approximated:
 *   - SESSION ISOLATION. psql started a fresh process per file, so a migration's
 *     `SET search_path` or `SET check_function_bodies` could not leak into the
 *     next. A fresh connection per file keeps that; a shared one would not.
 *   - ONE STATEMENT AT A TIME, IN AUTOCOMMIT, STOPPING AT THE FIRST ERROR — as
 *     `psql -v ON_ERROR_STOP=1 -f` did. Statements are split by `splitSql.mjs`,
 *     which lexes the way psql does.
 *
 *   The tempting alternative — send each file as ONE query — is wrong here, and
 *   was measured wrong: that runs the file as a single transaction, so a
 *   migration that fails part way on a bare cluster leaves NOTHING behind. The
 *   demo tenant is seeded by exactly such a file (`20260604120000_demo_data.sql`
 *   errors after seeding classes, teachers and students), and losing its seeded
 *   half took the replica from 59 failed migrations to 106 as everything built on
 *   it failed after it. Supabase does apply migrations atomically, but the live
 *   project had the state these files needed and the replica does not; psql's
 *   partial apply is what recovers the most of the live schema from a bare one.
 *
 *   Measured before switching: no migration uses a psql meta-command, and none
 *   runs a statement that refuses a transaction block (the one CONCURRENTLY is
 *   in a comment).
 *
 *   node apply.mjs              rebuild, prelude, migrations
 *   node apply.mjs --no-rebuild apply migrations onto the existing database
 *   node apply.mjs --ready      exit 0 when the server answers, 1 when it does not
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import os from "os";
import path from "path";
import pg from "pg";
import { splitSql } from "./splitSql.mjs";

// `new URL(import.meta.url).pathname` is `/C:/Users/…` on Windows, which
// `path.resolve` turns into `C:\C:\Users\…`. fileURLToPath is correct on both.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MIG = path.join(REPO, "supabase/migrations");
const TMP = path.join(os.tmpdir(), "gurukul-local-replica");
mkdirSync(TMP, { recursive: true });

const DB = process.env.GK_DB || "gurukul";
const PORT = Number(process.env.GK_PORT || "5433");
const HOST = process.env.GK_HOST || "127.0.0.1";
const rebuild = !process.argv.includes("--no-rebuild");

const connect = async (database) => {
  const client = new pg.Client({ host: HOST, port: PORT, user: "postgres", database });
  // A failed migration must not print as an unhandled 'error' event.
  client.on("error", () => {});
  await client.connect();
  return client;
};

/**
 * Run one SQL script on a fresh connection, statement by statement in
 * autocommit, stopping at the first error. Throws with the server's message and
 * the statement it came from.
 */
async function runFile(sql) {
  const client = await connect(DB);
  try {
    for (const stmt of splitSql(sql)) {
      try {
        await client.query(stmt);
      } catch (e) {
        e.statement = stmt.trim().slice(0, 160);
        throw e;
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--ready")) {
  try {
    await (await connect("postgres")).end();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

if (rebuild) {
  const admin = await connect("postgres");
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  await runFile(readFileSync(path.join(HERE, "prelude.sql"), "utf8"));
  console.log(`rebuilt ${DB} and applied the prelude`);
}

const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const results = [];
let applied = 0;
let failed = 0;

for (const f of files) {
  let sql = readFileSync(path.join(MIG, f), "utf8");

  // The only local transformation: pgvector is not installable on this cluster.
  // Migrations that create a `vector` column are rewritten to `real[]`, which
  // is what the repo's own fallback branch does when pgvector is absent
  // ("pgvector unavailable — using embedding_compat real[] only"). Nothing on a
  // probed path touches an embedding; this keeps the question-bank tables
  // creatable so later migrations that reference them still apply.
  const transformed = /vector\s*\(\s*\d+\s*\)/i.test(sql) || /USING (ivfflat|hnsw)/i.test(sql);
  if (transformed) {
    sql = sql
      .replace(/vector\s*\(\s*\d+\s*\)/gi, "real[]")
      .replace(/CREATE\s+(INDEX|UNIQUE INDEX)([\s\S]*?)USING\s+(ivfflat|hnsw)[\s\S]*?;/gi, "-- [local] vector index skipped;")
      .replace(/CREATE EXTENSION IF NOT EXISTS vector[^;]*;/gi, "-- [local] pgvector unavailable;");
  }

  try {
    await runFile(sql);
    applied++;
    results.push({ file: f, ok: true, transformed });
  } catch (e) {
    failed++;
    const err = [e.message, e.detail, e.hint, e.where, e.statement && `at: ${e.statement}`]
      .filter(Boolean)
      .join(" | ");
    results.push({ file: f, ok: false, transformed, error: err.slice(0, 600) });
    console.log(`FAIL ${f}\n     ${err.split("\n").slice(0, 4).join("\n     ").slice(0, 400)}`);
  }
}

writeFileSync(path.join(TMP, "apply-report.json"), JSON.stringify({ applied, failed, results }, null, 2));
console.log(`\napplied ${applied} / ${files.length}, failed ${failed}`);
console.log(`report: ${path.join(TMP, "apply-report.json")}`);
