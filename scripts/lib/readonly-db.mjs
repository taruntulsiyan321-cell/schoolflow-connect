/**
 * One read path for the three credential-blocked gates.
 *
 *   import { queryRows, describeConnection } from "./lib/readonly-db.mjs";
 *
 * TWO WAYS IN, AND THEY ARE NOT EQUIVALENT
 *
 *   CI_READONLY_DATABASE_URL  -> a direct Postgres connection as
 *                                gurukul_ci_readonly. Read-only enforced BY THE
 *                                DATABASE. This is what belongs in CI.
 *   SUPABASE_ACCESS_TOKEN     -> the Management API's /database/query endpoint,
 *                                which runs arbitrary SQL as the database
 *                                owner. Convenient locally, and must never be a
 *                                repository secret: quality.yml triggers on
 *                                pull_request, same-repo PRs receive secrets,
 *                                and one added line could echo an account-wide
 *                                token to an external host.
 *
 * The connection string is preferred when both are present, so a machine that
 * has both does not quietly exercise the more powerful path.
 *
 * WHY NOT JUST TRUST THE ROLE
 * default_transaction_read_only is set on every pg session as well. The role
 * already cannot write, so this is redundant -- deliberately. A gate is the
 * last place to rely on exactly one thing being right, and if this module is
 * ever pointed at a more privileged connection string by mistake, the session
 * still refuses to write.
 */
import { readFileSync, existsSync } from "fs";

let envLoaded = false;
function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

export function connectionMode() {
  loadEnv();
  if (process.env.CI_READONLY_DATABASE_URL) return "readonly-role";
  if (process.env.SUPABASE_ACCESS_TOKEN) return "management-api";
  return "none";
}

/**
 * A one-line description for a gate to print. Gates say which path they used,
 * because "PASS" means something different depending on what could have been
 * seen: the read-only role has BYPASSRLS precisely so an empty result means
 * empty and not invisible, and a reader deserves to know which one ran.
 */
export function describeConnection() {
  const mode = connectionMode();
  if (mode === "readonly-role") return "direct Postgres as gurukul_ci_readonly (read-only, BYPASSRLS)";
  if (mode === "management-api") return "Management API as the database owner (local convenience path)";
  return "no credential";
}

let pool = null;
async function getPool() {
  if (pool) return pool;
  const { default: pg } = await import("pg");
  pool = new pg.Pool({
    connectionString: process.env.CI_READONLY_DATABASE_URL,
    max: 1,
    // Supabase's pooler terminates idle clients; a gate is short-lived anyway.
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 15000,
  });
  pool.on("connect", (client) => {
    // Belt and braces -- see the header. Fire-and-forget is fine: if it fails
    // the role still cannot write.
    client.query("SET default_transaction_read_only = on").catch(() => {});
  });
  return pool;
}

export async function queryRows(sql) {
  const mode = connectionMode();

  if (mode === "none") {
    throw new Error(
      "No database credential.\n" +
        "  CI_READONLY_DATABASE_URL is the one CI should use (read-only role).\n" +
        "  SUPABASE_ACCESS_TOKEN is the local convenience path and must not be a repository secret.",
    );
  }

  if (mode === "readonly-role") {
    const p = await getPool();
    const res = await p.query(sql);
    return res.rows;
  }

  const ref = process.env.VITE_SUPABASE_PROJECT_ID || process.env.PROJECT_REF || "psqxykzqfvxgsvkmgurn";
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 400)}`);
  const out = JSON.parse(text);
  if (!Array.isArray(out)) throw new Error(`Management API returned ${JSON.stringify(out).slice(0, 300)}`);
  return out;
}

/**
 * Close the pool so the process can exit. Safe to call when no pool was opened.
 * Gates should call this rather than process.exit() after a query: exiting with
 * work in flight tears down the client's handles and aborts with a libuv
 * assertion, so the shell sees 127 instead of the code the gate chose.
 */
export async function closeConnection() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end().catch(() => {});
}
